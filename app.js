'use strict';
/*
 * Gym – registro personal de entrenamientos.
 * Todo el código de la app está en este archivo, dividido en secciones:
 *   1. Utilidades
 *   2. Base de datos local (IndexedDB)
 *   3. Datos y reglas (rutinas, progresión, fusionar…)
 *   4. Sincronización con Google Sheets
 *   5. Pantallas
 *   6. Acciones (lo que hace cada botón)
 *   7. Arranque
 * No hay datos personales ni claves aquí: la URL del script y la clave se
 * escriben en Ajustes y se guardan solo en el dispositivo.
 */
const APP_VERSION = '1.1.0';

/* ==================== 1. Utilidades ==================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const byName = (a, b) => a.name.localeCompare(b.name, 'es');
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
function fmtDate(s, withYear = false) {
  const d = parseDate(s);
  const y = withYear || d.getFullYear() !== new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y ? ' ' + d.getFullYear() : ''}`;
}
const fmtDateTime = (ms) => { const d = new Date(ms); return `${fmtDate(isoDate(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtNum = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });
const fmtW = (w) => (w === 0 ? 'PC' : fmtNum(w)); // PC = peso corporal
const fmtSet = (s) => `${fmtW(s.weight)} × ${s.reps}`;
const inputNum = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));
const round2 = (x) => Math.round(x * 100) / 100;
function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function weekStart(dateStr) { // lunes de la semana
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
}
const daysBetween = (a, b) => Math.floor((b - a) / 86400000);

let toastTimer;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Ejecuta las acciones de una en una, para que nunca se pisen al guardar.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn).catch((e) => { console.error(e); toast('Error: ' + e.message); }));

/* ==================== 2. Base de datos local ==================== */
let dbPromise;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open('gym', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('exercises', { keyPath: 'id' });
        d.createObjectStore('routines', { keyPath: 'id' });
        const s = d.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('status', 'status');
        const t = d.createObjectStore('sets', { keyPath: 'id' });
        t.createIndex('session', 'sessionId');
        t.createIndex('exDate', ['exerciseId', 'date']);
        d.createObjectStore('deletions', { keyPath: 'id' }); // borrados pendientes de enviar a Google
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}
const p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(stores, mode, fn) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Operación cancelada'));
    const fail = (e) => { reject(e); try { t.abort(); } catch { /* ya cerrada */ } };
    try { Promise.resolve(fn(t)).then((v) => { result = v; }, fail); } catch (e) { fail(e); }
  });
}
const os = (t, s) => t.objectStore(s);
const dbGet = (s, k) => tx([s], 'readonly', (t) => p(os(t, s).get(k)));
const dbAll = (s) => tx([s], 'readonly', (t) => p(os(t, s).getAll()));
const dbPut = (s, ...vals) => tx([s], 'readwrite', (t) => { vals.forEach((v) => os(t, s).put(v)); });
const dbDel = (s, k) => tx([s], 'readwrite', (t) => { os(t, s).delete(k); });
const getMeta = async (k, def = null) => (await dbGet('meta', k))?.value ?? def;
const setMeta = (k, value) => dbPut('meta', { key: k, value });
const exRange = (id) => IDBKeyRange.bound([id, ''], [id, '￿']);
const setsOfSession = (id) => tx(['sets'], 'readonly', (t) => p(os(t, 'sets').index('session').getAll(id)));
const setsOfExercise = (id) => tx(['sets'], 'readonly', (t) => p(os(t, 'sets').index('exDate').getAll(exRange(id))));
const currentSession = () => tx(['sessions'], 'readonly', (t) => p(os(t, 'sessions').index('status').get('en_curso')));
const exercisesMap = async () => new Map((await dbAll('exercises')).map((e) => [e.id, e]));

// Última serie registrada de un ejercicio (para la lista del historial).
const lastSetOf = (exerciseId) => tx(['sets'], 'readonly', (t) => new Promise((resolve, reject) => {
  const r = os(t, 'sets').index('exDate').openCursor(exRange(exerciseId), 'prev');
  r.onsuccess = () => resolve(r.result ? r.result.value : null);
  r.onerror = () => reject(r.error);
}));

// Series de la última sesión de un ejercicio (sin leer todo el historial: rápido con años de datos).
const lastSessionOf = (exerciseId, excludeSessionId) => tx(['sets'], 'readonly', (t) => new Promise((resolve, reject) => {
  const out = [];
  let sid = null, date = null;
  const finish = () => resolve({ sessionId: sid, date, sets: out.sort((a, b) => a.setNumber - b.setNumber) });
  const r = os(t, 'sets').index('exDate').openCursor(exRange(exerciseId), 'prev');
  r.onerror = () => reject(r.error);
  r.onsuccess = () => {
    const c = r.result;
    if (!c) return finish();
    const s = c.value;
    if (s.sessionId === excludeSessionId) return c.continue();
    if (sid === null) { sid = s.sessionId; date = s.date; }
    if (s.date < date) return finish();
    if (s.sessionId === sid) out.push(s);
    c.continue();
  };
}));

/* ==================== 3. Datos y reglas ==================== */
// Marca un objeto como modificado (pendiente de enviar a Google).
const touch = (o) => Object.assign(o, { updatedAt: Date.now(), dirty: true });
// Cada ejercicio dentro de una rutina lleva su objetivo y una nota propia de esa rutina (botón ⓘ).
const newItem = (exerciseId) => ({ exerciseId, sets: 3, repMin: 8, repMax: 12, increment: 2.5, note: '' });
const targetText = (i, sep = ' × ') => `${i.sets}${sep}${i.repMin === i.repMax ? i.repMin : `${i.repMin}–${i.repMax}`}`;
const activeRoutine = async () => (await dbAll('routines')).find((r) => !r.endDate) || null;

async function seedIfNeeded() {
  if (await getMeta('seeded')) return;
  if ((await dbAll('exercises')).length) { await setMeta('seeded', true); return; }
  const names = ['Press banca', 'Press militar', 'Fondos', 'Dominadas', 'Remo con barra',
    'Curl de bíceps', 'Sentadilla', 'Peso muerto rumano', 'Prensa de piernas'];
  // Los datos de ejemplo no se suben a Google salvo que se usen o se editen
  // (así no ensucian la hoja al configurar un móvil nuevo antes de restaurar).
  const seed = (o) => Object.assign(o, { updatedAt: Date.now(), dirty: false, seed: true });
  const ex = names.map((name) => seed({ id: uuid(), name, notes: '', archived: false }));
  const it = (i, inc = 2.5) => ({ ...newItem(ex[i].id), increment: inc });
  const routine = seed({
    id: uuid(), name: 'Rutina de ejemplo', startDate: today(), endDate: null,
    days: [
      { id: uuid(), name: 'D1 Empuje', weekday: 1, items: [it(0), it(1), it(2)] },
      { id: uuid(), name: 'D2 Tirón', weekday: 3, items: [it(3), it(4), it(5)] },
      { id: uuid(), name: 'D3 Pierna', weekday: 5, items: [it(6, 5), it(7), it(8, 5)] },
    ],
  });
  await tx(['exercises', 'routines', 'meta'], 'readwrite', (t) => {
    ex.forEach((e) => os(t, 'exercises').put(e));
    os(t, 'routines').put(routine);
    os(t, 'meta').put({ key: 'seeded', value: true });
  });
}

// Día que toca: el asignado a hoy; si no, el siguiente al último entrenado; si no, el primero.
async function suggestedDay(routine) {
  const wd = new Date().getDay();
  const byWeekday = routine.days.find((d) => d.weekday === wd);
  if (byWeekday) return byWeekday.id;
  const last = (await dbAll('sessions'))
    .filter((s) => s.routineId === routine.id && s.status === 'terminada')
    .sort((a, b) => (b.date + (b.startedAt || 0)).localeCompare(a.date + (a.startedAt || 0)))[0];
  if (last) {
    const i = routine.days.findIndex((d) => d.id === last.dayId);
    if (i >= 0) return routine.days[(i + 1) % routine.days.length].id;
  }
  return routine.days[0].id;
}

// Doble progresión: si en la última sesión llegaste al máximo de reps en TODAS
// las series → subir peso; si no → mismo peso y buscar más reps.
function progression(item, last) {
  if (!last || !last.sets.length) return null;
  const sets = last.sets;
  const top = Math.max(...sets.map((s) => s.weight));
  const allMax = sets.length >= item.sets && sets.every((s) => s.reps >= item.repMax);
  if (allMax && !item.increment) {
    return { up: false, text: '✓ Objetivo cumplido', prefill: (i) => { const s = sets[Math.min(i, sets.length - 1)]; return { w: s.weight, r: s.reps }; } };
  }
  if (allMax) {
    const w = round2(top + item.increment);
    return { up: true, text: `↑ Sube a ${fmtNum(w)} kg`, prefill: () => ({ w, r: item.repMin }) };
  }
  return {
    up: false,
    text: top ? `→ Mantén ${fmtNum(top)} kg y busca más reps` : '→ Busca más reps',
    prefill: (i) => { const s = sets[Math.min(i, sets.length - 1)]; return { w: s.weight, r: s.reps }; },
  };
}

// Marca una sesión terminada como pendiente de volver a enviar.
async function markSessionChanged(sessionId) {
  const s = await dbGet('sessions', sessionId);
  if (!s) return;
  s.updatedAt = Date.now();
  if (s.status === 'terminada') s.synced = false;
  await dbPut('sessions', s);
  if (s.status === 'terminada') scheduleSync();
}

// Fusionar: todas las series de "fromId" pasan a "intoId" y "fromId" desaparece.
async function mergeExercises(fromId, intoId) {
  await tx(['exercises', 'routines', 'sets', 'sessions', 'deletions'], 'readwrite', async (t) => {
    const sets = await p(os(t, 'sets').index('exDate').getAll(exRange(fromId)));
    const sessionIds = new Set();
    for (const s of sets) { s.exerciseId = intoId; os(t, 'sets').put(s); sessionIds.add(s.sessionId); }
    for (const id of sessionIds) {
      const ses = await p(os(t, 'sessions').get(id));
      if (ses) { ses.updatedAt = Date.now(); if (ses.status === 'terminada') ses.synced = false; os(t, 'sessions').put(ses); }
    }
    for (const r of await p(os(t, 'routines').getAll())) {
      let changed = false;
      for (const d of r.days) {
        const hasInto = d.items.some((i) => i.exerciseId === intoId);
        const before = d.items.length;
        d.items = d.items.filter((i) => !(i.exerciseId === fromId && hasInto));
        d.items.forEach((i) => { if (i.exerciseId === fromId) { i.exerciseId = intoId; changed = true; } });
        if (d.items.length !== before) changed = true;
      }
      if (changed) os(t, 'routines').put(touch(r));
    }
    const into = await p(os(t, 'exercises').get(intoId));
    os(t, 'exercises').put(touch(into));
    os(t, 'exercises').delete(fromId);
    os(t, 'deletions').put({ id: fromId, kind: 'exercise' });
  });
  scheduleSync();
}

async function exportCsv() {
  const [sets, sessions, exMap, routines] = await Promise.all([dbAll('sets'), dbAll('sessions'), exercisesMap(), dbAll('routines')]);
  const sesMap = new Map(sessions.map((s) => [s.id, s]));
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita que Excel lo interprete como fórmula
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (n) => String(n).replace('.', ',');
  const lines = [['Fecha', 'Rutina', 'Día', 'Ejercicio', 'Serie', 'Peso (kg)', 'Reps', 'Nota', 'ID sesión', 'ID serie'].join(';')];
  sets.sort((a, b) => a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId) || a.exerciseId.localeCompare(b.exerciseId) || a.setNumber - b.setNumber);
  for (const s of sets) {
    const ses = sesMap.get(s.sessionId) || {};
    const r = routines.find((x) => x.id === ses.routineId);
    const d = r?.days.find((x) => x.id === ses.dayId);
    const [y, m, dd] = s.date.split('-');
    lines.push([`${dd}/${m}/${y}`, r?.name ?? ses.routineName ?? '', d?.name ?? ses.dayName ?? '',
      exMap.get(s.exerciseId)?.name ?? '', s.setNumber, num(s.weight), s.reps, s.note || '', s.sessionId, s.id].map(cell).join(';'));
  }
  // BOM + ";" + coma decimal: así Excel en español lo abre bien con doble clic.
  const csv = '﻿' + lines.join('\r\n') + '\r\n';
  const name = `gym-${today()}.csv`;
  const file = new File([csv], name, { type: 'text/csv;charset=utf-8' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/* ==================== 4. Sincronización con Google Sheets ==================== */
const SYNC_CHUNK = 40;            // sesiones por envío
const SYNC_IDLE_MS = 6 * 3600e3;  // sin cambios pendientes, comprobar como mucho cada 6 h
let syncing = null, syncTimer = null;

class SyncError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }
const settings = async () => (await getMeta('settings')) || { url: '', secret: '' };
function scheduleSync(ms = 3000) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), ms); }

async function callScript(body, cfg) {
  cfg = cfg || await settings();
  if (!cfg.url || !cfg.secret) throw new SyncError('Falta la URL o la clave en Ajustes', 'config');
  // CORS y Apps Script: Apps Script no responde a la petición previa "OPTIONS" que
  // hace el navegador antes de un POST con JSON. Para evitarla enviamos una
  // "petición simple": POST con Content-Type text/plain y sin cabeceras propias.
  // El JSON va como texto en el cuerpo (también la clave) y el script lo lee con
  // e.postData.contents. Google responde con una redirección a
  // script.googleusercontent.com, que fetch sigue automáticamente.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, secret: cfg.secret }),
    });
  } catch {
    throw new SyncError(navigator.onLine ? 'No se pudo contactar con Google' : 'Sin conexión', 'network');
  } finally { clearTimeout(timer); }
  let data;
  try { data = await res.json(); } catch { throw new SyncError('Google respondió algo inesperado. Revisa la URL', 'server'); }
  if (!data.ok) throw new SyncError(data.error || 'Error en el script', 'server');
  return data;
}

function routineOut(r, exMap) {
  return {
    id: r.id, nombre: r.name, inicio: r.startDate, fin: r.endDate || '',
    dias: r.days.map((d) => ({
      id: d.id, nombre: d.name, dia_semana: d.weekday,
      ejercicios: d.items.map((i) => ({
        ejercicio_id: i.exerciseId, ejercicio: exMap.get(i.exerciseId)?.name ?? '',
        series: i.sets, reps_min: i.repMin, reps_max: i.repMax, incremento: i.increment, notas: i.note || '',
      })),
    })),
  };
}

function rowOf(set, s, exMap, routines) {
  const r = routines.find((x) => x.id === s.routineId);
  const d = r?.days.find((x) => x.id === s.dayId);
  return {
    id: set.id, fecha: set.date, rutina: r?.name ?? s.routineName ?? '', dia: d?.name ?? s.dayName ?? '',
    ejercicio_id: set.exerciseId, ejercicio: exMap.get(set.exerciseId)?.name ?? '',
    serie: set.setNumber, peso: set.weight, reps: set.reps, nota: set.note || '',
    id_sesion: s.id, id_rutina: s.routineId, id_dia: s.dayId,
  };
}

async function pendingCounts() {
  const [sessions, exs, routines, dels] = await Promise.all([dbAll('sessions'), dbAll('exercises'), dbAll('routines'), dbAll('deletions')]);
  return {
    sessions: sessions.filter((s) => s.status === 'terminada' && !s.synced).length,
    other: exs.filter((e) => e.dirty).length + routines.filter((r) => r.dirty).length + dels.length,
  };
}

function syncNow({ force = false } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    const cfg = await settings();
    if (!cfg.url || !cfg.secret) return { skipped: 'config' };
    try {
      const [exs, routines, sessions, deletions] = await Promise.all([dbAll('exercises'), dbAll('routines'), dbAll('sessions'), dbAll('deletions')]);
      const exMap = new Map(exs.map((e) => [e.id, e]));
      const pend = sessions.filter((s) => s.status === 'terminada' && !s.synced).sort((a, b) => a.date.localeCompare(b.date));
      const setsBySession = new Map();
      for (const s of pend) setsBySession.set(s.id, await setsOfSession(s.id));
      // Datos de ejemplo que ya se usan en un entreno: hay que enviarlos también.
      const usedR = new Set(pend.map((s) => s.routineId));
      const dirtyR = routines.filter((r) => r.dirty || (r.seed && usedR.has(r.id)));
      const usedEx = new Set([...setsBySession.values()].flat().map((s) => s.exerciseId));
      dirtyR.forEach((r) => r.days.forEach((d) => d.items.forEach((i) => usedEx.add(i.exerciseId))));
      const dirtyEx = exs.filter((e) => e.dirty || (e.seed && usedEx.has(e.id)));
      const nothing = !pend.length && !dirtyEx.length && !dirtyR.length && !deletions.length;
      if (nothing && !force && Date.now() - (await getMeta('lastSync', 0)) < SYNC_IDLE_MS) return { skipped: 'idle' };

      const chunks = [];
      for (let i = 0; i < pend.length; i += SYNC_CHUNK) chunks.push(pend.slice(i, i + SYNC_CHUNK));
      if (!chunks.length) chunks.push([]);
      let first = true;
      for (const chunk of chunks) {
        const rows = [];
        for (const s of chunk) for (const set of setsBySession.get(s.id)) rows.push(rowOf(set, s, exMap, routines));
        const body = { action: 'sync', sesiones: chunk.map((s) => s.id), registros: rows };
        if (first) {
          body.ejercicios = dirtyEx.map((e) => ({ id: e.id, nombre: e.name, notas: e.notes || '', archivado: !!e.archived }));
          body.rutinas = dirtyR.map((r) => routineOut(r, exMap));
          body.borrados = deletions;
        }
        await callScript(body, cfg);
        // Marcar como enviado solo lo que no haya cambiado mientras tanto.
        await tx(['sessions', 'exercises', 'routines', 'deletions'], 'readwrite', async (t) => {
          for (const s of chunk) {
            const cur = await p(os(t, 'sessions').get(s.id));
            if (cur && cur.updatedAt === s.updatedAt && cur.status === 'terminada') { cur.synced = true; os(t, 'sessions').put(cur); }
          }
          if (!first) return;
          for (const [store, list] of [['exercises', dirtyEx], ['routines', dirtyR]]) {
            for (const o of list) {
              const cur = await p(os(t, store).get(o.id));
              if (cur && cur.updatedAt === o.updatedAt) { cur.dirty = false; cur.seed = false; os(t, store).put(cur); }
            }
          }
          deletions.forEach((d) => os(t, 'deletions').delete(d.id));
        });
        first = false;
      }
      await setMeta('lastSync', Date.now());
      await setMeta('syncError', null);
      return { ok: true, sent: pend.length };
    } catch (e) {
      await setMeta('syncError', { msg: e.message, kind: e.kind || 'server', at: Date.now() });
      return { error: e };
    }
  })().finally(() => { syncing = null; refreshSyncUI(); });
  return syncing;
}

async function syncInfo() {
  const [cfg, counts, err, last] = await Promise.all([settings(), pendingCounts(), getMeta('syncError'), getMeta('lastSync')]);
  const n = counts.sessions;
  const pendText = n === 1 ? '1 sesión pendiente' : `${n} sesiones pendientes`;
  if (!cfg.url || !cfg.secret) return { cls: 'error', text: 'Copia en Google sin configurar', last };
  if (err && err.kind !== 'network') return { cls: 'error', text: `Error: ${err.msg}`, last };
  if (n) return { cls: 'pending', text: pendText + (err ? ' · sin conexión' : ''), last };
  if (counts.other) return { cls: 'pending', text: 'Cambios pendientes de enviar' + (err ? ' · sin conexión' : ''), last };
  return { cls: 'ok', text: 'Todo sincronizado', last };
}

async function refreshSyncUI() {
  const el = $('#sync-status');
  if (el) {
    const info = await syncInfo();
    el.className = `status ${info.cls}`;
    el.innerHTML = `<span class="dot"></span><span>${esc(info.text)}</span>`;
    const last = $('#sync-last');
    if (last) last.textContent = `Última copia: ${info.last ? fmtDateTime(info.last) : 'nunca'}`;
  }
  updateBanner();
}

// Restaurar: borra los datos del móvil y los reconstruye desde la hoja.
async function restoreFromGoogle() {
  const data = await callScript({ action: 'restore' });
  const now = Date.now();
  const exercises = new Map(data.ejercicios.map((e) => [e.id, {
    id: e.id, name: e.nombre, notes: e.notas || '', archived: !!e.archivado, dirty: false, updatedAt: now,
  }]));
  const routines = data.rutinas.map((r) => ({
    id: r.id, name: r.nombre, startDate: r.inicio, endDate: r.fin || null, dirty: false, updatedAt: now,
    days: r.dias.map((d) => ({
      id: d.id, name: d.nombre, weekday: d.dia_semana ?? null,
      items: d.ejercicios.map((i) => ({
        exerciseId: i.ejercicio_id, sets: Number(i.series), repMin: Number(i.reps_min),
        repMax: Number(i.reps_max), increment: Number(i.incremento), note: i.notas || '',
      })),
    })),
  }));
  const sessions = new Map();
  const sets = [];
  for (const row of data.registros) {
    if (!sessions.has(row.id_sesion)) {
      sessions.set(row.id_sesion, {
        id: row.id_sesion, date: row.fecha, startedAt: null, routineId: row.id_rutina, dayId: row.id_dia,
        routineName: row.rutina, dayName: row.dia, status: 'terminada', synced: true, updatedAt: now,
      });
    }
    if (!exercises.has(row.ejercicio_id)) {
      exercises.set(row.ejercicio_id, { id: row.ejercicio_id, name: row.ejercicio, notes: '', archived: false, dirty: false, updatedAt: now });
    }
    sets.push({
      id: row.id, sessionId: row.id_sesion, exerciseId: row.ejercicio_id, setNumber: Number(row.serie),
      weight: Number(row.peso), reps: Number(row.reps), note: row.nota || '', date: row.fecha,
    });
  }
  await tx(['exercises', 'routines', 'sessions', 'sets', 'deletions', 'meta'], 'readwrite', (t) => {
    ['exercises', 'routines', 'sessions', 'sets', 'deletions'].forEach((s) => os(t, s).clear());
    exercises.forEach((e) => os(t, 'exercises').put(e));
    routines.forEach((r) => os(t, 'routines').put(r));
    sessions.forEach((s) => os(t, 'sessions').put(s));
    sets.forEach((s) => os(t, 'sets').put(s));
    os(t, 'meta').put({ key: 'seeded', value: true });
    os(t, 'meta').put({ key: 'lastSync', value: now });
    os(t, 'meta').put({ key: 'syncError', value: null });
  });
  return { exercises: exercises.size, routines: routines.length, sessions: sessions.size, sets: sets.length };
}

/* ==================== 5. Pantallas ==================== */
const ui = { dayId: null, preDraft: {}, chart: 'peso', histAll: false, edit: null, picker: null, token: 0, route: '' };

async function render({ keepScroll = false } = {}) {
  const token = ++ui.token;
  const parts = (location.hash.slice(1) || 'entrenar').split('/');
  const tab = VIEWS[parts[0]] ? parts[0] : 'entrenar';
  $$('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const y = window.scrollY;
  let html;
  try { html = await VIEWS[tab](...parts.slice(1)); } catch (e) {
    console.error(e);
    html = `<div class="card"><h2>Algo ha fallado</h2><p class="muted small">${esc(e.message)}</p></div>`;
  }
  if (token !== ui.token) return;
  $('#view').innerHTML = html;
  const route = location.hash;
  window.scrollTo(0, keepScroll && route === ui.route ? y : 0);
  ui.route = route;
  updateBanner();
}
const rerender = () => render({ keepScroll: true });

async function updateBanner() {
  const b = $('#banner');
  const finished = (await dbAll('sessions')).filter((s) => s.status === 'terminada');
  let msg = null;
  if (finished.length) {
    const last = await getMeta('lastSync');
    const ref = last || Math.min(...finished.map((s) => s.endedAt || parseDate(s.date).getTime()));
    const days = daysBetween(ref, Date.now());
    if (days > 7) {
      msg = last
        ? `⚠ Hace ${days} días que no se hace copia en Google. <a href="#ajustes">Revisar</a>`
        : `⚠ Aún no has hecho ninguna copia en Google. <a href="#ajustes">Configurar</a>`;
    }
  }
  b.hidden = !msg;
  b.innerHTML = msg || '';
}

/* ---------- Entrenar ---------- */
function setRow({ exId, n, w, r, note, done, setId, mode }) {
  return `<div class="set${done ? ' done' : ''}" data-ex="${exId}" data-n="${n}" data-mode="${mode}"${setId ? ` data-id="${setId}"` : ''}>
    <div class="n">${n}</div>
    <div class="unit kg"><input data-f="w" inputmode="decimal" autocomplete="off" value="${esc(inputNum(w))}" aria-label="Peso serie ${n}"></div>
    <div class="unit reps"><input data-f="r" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(inputNum(r))}" aria-label="Repeticiones serie ${n}"></div>
    <button class="note-btn${note ? ' has' : ''}" data-act="note" aria-label="Nota">✎</button>
    ${mode === 'train'
      ? '<button class="check" data-act="check" aria-label="Serie hecha">✓</button>'
      : '<button class="check" data-act="del-set" aria-label="Borrar serie">✕</button>'}
    ${note ? `<div class="set-note">${esc(note)}</div>` : ''}
  </div>`;
}

async function viewTrain() {
  const session = await currentSession();
  const routine = session ? await dbGet('routines', session.routineId) : await activeRoutine();
  if (!routine) {
    return `<h1>Entrenar</h1><div class="empty"><p>No tienes ninguna rutina activa.</p>
      <a class="btn btn-primary" href="#rutinas">Ir a Rutinas</a></div>`;
  }
  if (!routine.days.length) {
    return `<h1>Entrenar</h1><div class="empty"><p>Tu rutina no tiene días.</p>
      <a class="btn btn-primary" href="#rutinas/editar/${routine.id}">Editar rutina</a></div>`;
  }
  let dayId = session?.dayId;
  if (!dayId) {
    if (!ui.dayId || !routine.days.some((d) => d.id === ui.dayId)) ui.dayId = await suggestedDay(routine);
    dayId = ui.dayId;
  }
  const day = routine.days.find((d) => d.id === dayId) || routine.days[0];
  ui.train = { routineId: routine.id, dayId: day.id, routineName: routine.name, dayName: day.name, items: day.items };

  const exMap = await exercisesMap();
  const doneSets = session ? await setsOfSession(session.id) : [];
  const draft = session ? (session.draft || {}) : ui.preDraft;
  const lasts = await Promise.all(day.items.map((i) => lastSessionOf(i.exerciseId, session?.id)));

  let html = session
    ? `<p class="muted small">Entreno en curso · ${esc(routine.name)}</p>`
    : `<p class="muted small">${day.weekday === new Date().getDay() ? 'Hoy toca' : 'Siguiente'} · ${esc(routine.name)}</p>`;
  html += `<h1>${esc(day.name)}</h1>`;
  if (!session && routine.days.length > 1) {
    html += `<div class="chips">${routine.days.map((d) =>
      `<button class="chip${d.id === day.id ? ' on' : ''}" data-act="pick-day" data-id="${d.id}">${esc(d.name)}</button>`).join('')}</div>`;
  }
  if (!day.items.length) html += '<div class="empty">Este día no tiene ejercicios.</div>';

  day.items.forEach((item, idx) => {
    const ex = exMap.get(item.exerciseId);
    if (!ex) return;
    const last = lasts[idx];
    const prog = progression(item, last);
    const mine = doneSets.filter((s) => s.exerciseId === item.exerciseId);
    const d = draft[item.exerciseId] || {};
    const rows = Math.max(item.sets, d.rows || 0, ...mine.map((s) => s.setNumber));
    let rowsHtml = '';
    for (let n = 1; n <= rows; n++) {
      const s = mine.find((x) => x.setNumber === n);
      if (s) { rowsHtml += setRow({ exId: ex.id, n, w: s.weight, r: s.reps, note: s.note, done: true, setId: s.id, mode: 'train' }); continue; }
      const v = d.vals?.[n];
      const pre = prog ? prog.prefill(n - 1) : { w: '', r: '' };
      rowsHtml += setRow({ exId: ex.id, n, w: v ? v.w : pre.w, r: v ? v.r : pre.r, note: v?.note, done: false, mode: 'train' });
    }
    html += `<section class="card">
      <div class="ex-head"><div class="ex-name"><h2>${esc(ex.name)}</h2>${item.note ? ` <button class="info-btn" data-act="info" data-di="${idx}" aria-label="Notas del ejercicio">i</button>` : ''}</div><span class="target">${targetText(item)}</span></div>
      ${last.sets.length
        ? `<div class="last"><span class="date">Última vez · ${fmtDate(last.date)}</span><b>${last.sets.map(fmtSet).join(' · ')}</b></div>`
        : '<div class="last muted">Primera vez con este ejercicio</div>'}
      ${prog ? `<span class="hint${prog.up ? ' up' : ''}">${prog.text}</span>` : ''}
      <div class="sets">${rowsHtml}</div>
      <button class="btn-ghost btn-small add-set" data-act="add-set" data-ex="${ex.id}" data-rows="${rows}">+ Serie</button>
    </section>`;
  });

  if (session) {
    html += `<div class="finish-bar"><button class="btn btn-primary btn-block btn-big" data-act="finish">Terminar entreno</button></div>`;
  } else if (day.items.length) {
    html += '<p class="muted small center">Marca ✓ en cada serie al hacerla. El entreno empieza con la primera.</p>';
  }
  return html;
}

/* ---------- Historial ---------- */
async function viewHistory(sub, id) {
  if (sub === 'ex') return viewExercise(id);
  if (sub === 'ses') return viewSession(id);
  const exs = (await dbAll('exercises')).sort(byName);
  const lasts = await Promise.all(exs.map((e) => lastSetOf(e.id)));
  const item = (e, last) => `<a class="list-item" href="#historial/ex/${e.id}">
      <div class="main"><div class="title">${esc(e.name)}</div>
      <div class="sub">${last ? `${fmtDate(last.date)} · ${fmtSet(last)}` : 'Sin registros'}</div></div>
      <span class="chev">›</span></a>`;
  const active = exs.map((e, i) => (!e.archived ? item(e, lasts[i]) : '')).join('');
  const archived = exs.map((e, i) => (e.archived && lasts[i] ? item(e, lasts[i]) : '')).join('');
  return `<h1>Historial</h1>
    ${active ? `<div class="list">${active}</div>` : '<div class="empty">Aún no hay ejercicios.</div>'}
    ${archived ? `<h3>Archivados</h3><div class="list">${archived}</div>` : ''}`;
}

function chartSvg(points, unit) {
  if (points.length < 2) return '<p class="muted small">La gráfica aparece cuando haya registros de al menos dos semanas.</p>';
  const W = 360, H = 200, L = 36, R = 8, T = 10, B = 24; // tamaño cercano al real en el móvil: texto legible
  const xs = points.map((pt) => pt.x), ys = points.map((pt) => pt.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const padY = (y1 - y0) * 0.12; y0 = Math.max(0, y0 - padY); y1 += padY;
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const line = points.map((pt, i) => `${i ? 'L' : 'M'}${sx(pt.x).toFixed(1)},${sy(pt.y).toFixed(1)}`).join('');
  const area = `${line}L${sx(x1).toFixed(1)},${H - B}L${sx(x0).toFixed(1)},${H - B}Z`;
  let grid = '';
  for (const v of [y0, (y0 + y1) / 2, y1]) {
    const yy = sy(v).toFixed(1);
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtNum(Math.round(v))}</text>`;
  }
  const lbl = (ms) => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
  grid += `<text x="${L}" y="${H - 8}">${lbl(x0)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${lbl(x1)}</text>`;
  const dots = points.length <= 40 ? points.map((pt) => `<circle class="dot" cx="${sx(pt.x).toFixed(1)}" cy="${sy(pt.y).toFixed(1)}" r="3"/>`).join('') : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución semanal (${unit})">${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${dots}</svg>`;
}

async function viewExercise(id) {
  const ex = await dbGet('exercises', id);
  if (!ex) return '<a class="btn btn-ghost back" href="#historial">‹ Historial</a><div class="empty">Ejercicio no encontrado.</div>';
  const [sets, sessions, routines] = await Promise.all([setsOfExercise(id), dbAll('sessions'), dbAll('routines')]);
  const sesMap = new Map(sessions.map((s) => [s.id, s]));
  // Agrupar por sesión (las series vienen ordenadas por fecha)
  const groups = new Map();
  const weeks = new Map();
  for (const s of sets) {
    if (!groups.has(s.sessionId)) groups.set(s.sessionId, { date: s.date, sets: [] });
    groups.get(s.sessionId).sets.push(s);
    const wk = weekStart(s.date);
    const w = weeks.get(wk) || { max: 0, vol: 0 };
    w.max = Math.max(w.max, s.weight); w.vol += s.weight * s.reps;
    weeks.set(wk, w);
  }
  const points = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([wk, v]) => ({ x: parseDate(wk).getTime(), y: ui.chart === 'peso' ? v.max : v.vol }));
  const list = [...groups.entries()].reverse();
  const shown = ui.histAll ? list : list.slice(0, 30);
  const items = shown.map(([sid, g]) => {
    const ses = sesMap.get(sid) || {};
    const r = routines.find((x) => x.id === ses.routineId);
    const dayName = r?.days.find((x) => x.id === ses.dayId)?.name ?? ses.dayName ?? '';
    const live = ses.status === 'en_curso';
    return `<a class="list-item" href="${live ? '#entrenar' : `#historial/ses/${sid}`}">
      <div class="main"><div class="title">${fmtDate(g.date, true)}${live ? ' · en curso' : ''}</div>
      <div class="sub">${g.sets.sort((a, b) => a.setNumber - b.setNumber).map(fmtSet).join(' · ')}${dayName ? ` — ${esc(dayName)}` : ''}</div></div>
      <span class="chev">›</span></a>`;
  }).join('');
  return `<a class="btn btn-ghost back" href="#historial">‹ Historial</a>
    <h1>${esc(ex.name)}</h1>
    ${ex.notes ? `<p class="muted">${esc(ex.notes)}</p>` : ''}
    <div class="card">
      <div class="seg"><button class="${ui.chart === 'peso' ? 'on' : ''}" data-act="chart" data-mode="peso">Peso máx.</button><button class="${ui.chart === 'vol' ? 'on' : ''}" data-act="chart" data-mode="vol">Volumen</button></div>
      ${chartSvg(points, ui.chart === 'peso' ? 'kg' : 'kg × reps')}
      <p class="muted small" style="margin:6px 0 0">${ui.chart === 'peso' ? 'Peso máximo de cada semana (kg)' : 'Volumen semanal: peso × reps (kg)'}</p>
    </div>
    <h3>Sesiones (${list.length})</h3>
    ${items ? `<div class="list">${items}</div>` : '<div class="empty">Sin registros todavía.</div>'}
    ${!ui.histAll && list.length > 30 ? `<button class="btn btn-block" data-act="hist-all">Ver todas</button>` : ''}`;
}

async function viewSession(id) {
  const s = await dbGet('sessions', id);
  if (!s) return '<a class="btn btn-ghost back" href="#historial">‹ Historial</a><div class="empty">Sesión no encontrada.</div>';
  const [sets, exMap, r] = await Promise.all([setsOfSession(id), exercisesMap(), dbGet('routines', s.routineId)]);
  const day = r?.days.find((d) => d.id === s.dayId);
  const order = day ? day.items.map((i) => i.exerciseId) : [];
  const groups = new Map();
  for (const st of sets.sort((a, b) => a.setNumber - b.setNumber)) {
    if (!groups.has(st.exerciseId)) groups.set(st.exerciseId, []);
    groups.get(st.exerciseId).push(st);
  }
  const ids = [...groups.keys()].sort((a, b) => ((order.indexOf(a) + 1) || 999) - ((order.indexOf(b) + 1) || 999));
  let html = `<a class="btn btn-ghost back" href="javascript:history.back()">‹ Volver</a>
    <h1>${fmtDate(s.date, true)}</h1>
    <p class="muted">${esc(r?.name ?? s.routineName ?? '')} · ${esc(day?.name ?? s.dayName ?? '')}</p>`;
  if (s.status === 'en_curso') html += '<p><a href="#entrenar">Este entreno está en curso → Entrenar</a></p>';
  if (!ids.length) html += '<div class="empty">Esta sesión no tiene series.</div>';
  for (const exId of ids) {
    html += `<section class="card"><h2>${esc(exMap.get(exId)?.name ?? 'Ejercicio')}</h2><div class="sets">
      ${groups.get(exId).map((st) => setRow({ exId, n: st.setNumber, w: st.weight, r: st.reps, note: st.note, done: false, setId: st.id, mode: 'edit' })).join('')}
    </div></section>`;
  }
  html += '<p class="muted small center">Los cambios se guardan solos y se envían a Google.</p>';
  return html;
}

/* ---------- Rutinas ---------- */
function daysSummary(r, exMap) {
  return r.days.map((d) => `<p><b>${esc(d.name)}</b>${d.weekday !== null && d.weekday !== undefined ? ` <span class="muted small">· ${WEEKDAYS[d.weekday]}</span>` : ''}<br>
    <span class="muted small">${d.items.map((i) => `${esc(exMap.get(i.exerciseId)?.name ?? '?')} ${targetText(i, '×')}`).join(' · ') || 'Sin ejercicios'}</span></p>`).join('');
}

async function viewRoutines(sub, id) {
  if (sub === 'editar' || sub === 'nueva') return viewRoutineEditor(sub, id);
  if (sub === 'ver') return viewRoutineReadonly(id);
  if (sub === 'catalogo') return viewCatalog();
  const [routines, exMap] = await Promise.all([dbAll('routines'), exercisesMap()]);
  const active = routines.find((r) => !r.endDate);
  const archived = routines.filter((r) => r.endDate).sort((a, b) => b.endDate.localeCompare(a.endDate));
  const nEx = [...exMap.values()].filter((e) => !e.archived).length;
  let html = '<h1>Rutinas</h1>';
  if (active) {
    html += `<section class="card">
      <div class="row"><h2 class="spacer">${esc(active.name)}</h2><span class="pill active">Activa</span></div>
      <p class="muted small">Desde ${fmtDate(active.startDate, true)}</p>
      ${daysSummary(active, exMap)}
      <div class="row wrap">
        <a class="btn btn-small" href="#rutinas/editar/${active.id}">Editar</a>
        <button class="btn-small" data-act="dup-routine" data-id="${active.id}">Duplicar</button>
        <button class="btn-small btn-danger" data-act="archive-routine" data-id="${active.id}">Archivar</button>
      </div></section>`;
  } else {
    html += '<div class="card"><p class="muted" style="margin:0">No hay ninguna rutina activa.</p></div>';
  }
  html += `<button class="btn btn-primary btn-block" data-act="new-routine">+ Nueva rutina</button>
    <h3>Ejercicios</h3>
    <div class="list"><a class="list-item" href="#rutinas/catalogo"><div class="main"><div class="title">Catálogo de ejercicios</div>
    <div class="sub">${nEx} ejercicios · renombrar, fusionar, archivar</div></div><span class="chev">›</span></a></div>`;
  if (archived.length) {
    html += `<h3>Archivadas</h3><div class="list">${archived.map((r) => `<a class="list-item" href="#rutinas/ver/${r.id}">
      <div class="main"><div class="title">${esc(r.name)}</div><div class="sub">${fmtDate(r.startDate, true)} – ${fmtDate(r.endDate, true)}</div></div>
      <span class="chev">›</span></a>`).join('')}</div>`;
  }
  return html;
}

async function viewRoutineReadonly(id) {
  const [r, exMap] = await Promise.all([dbGet('routines', id), exercisesMap()]);
  if (!r) return '<a class="btn btn-ghost back" href="#rutinas">‹ Rutinas</a><div class="empty">Rutina no encontrada.</div>';
  return `<a class="btn btn-ghost back" href="#rutinas">‹ Rutinas</a>
    <h1>${esc(r.name)}</h1>
    <p class="muted">${fmtDate(r.startDate, true)} – ${r.endDate ? fmtDate(r.endDate, true) : 'activa'} <span class="pill">Archivada</span></p>
    <section class="card">${daysSummary(r, exMap)}</section>
    <button class="btn btn-primary btn-block" data-act="dup-routine" data-id="${r.id}">Duplicar como nueva rutina</button>`;
}

async function viewRoutineEditor(sub, id) {
  if (sub === 'editar') {
    if (!ui.edit || ui.edit.id !== id || ui.edit.isNew) {
      const r = await dbGet('routines', id);
      if (!r) return '<a class="btn btn-ghost back" href="#rutinas">‹ Rutinas</a><div class="empty">Rutina no encontrada.</div>';
      if (r.endDate) { location.replace(`#rutinas/ver/${id}`); return ''; }
      ui.edit = { ...structuredClone(r), isNew: false };
    }
  } else if (!ui.edit || !ui.edit.isNew) {
    location.replace('#rutinas'); return '';
  }
  const ed = ui.edit;
  const exMap = await exercisesMap();
  const wdOptions = (sel) => `<option value="">— Sin día fijo —</option>${WEEK_ORDER.map((w) =>
    `<option value="${w}"${sel === w ? ' selected' : ''}>${WEEKDAYS[w]}</option>`).join('')}`;
  const days = ed.days.map((d, di) => `<section class="day-card">
      <div class="row"><input data-bind="day.name" data-di="${di}" value="${esc(d.name)}" aria-label="Nombre del día" placeholder="Nombre del día">
      <button class="icon-btn" data-act="day-del" data-di="${di}" aria-label="Quitar día">✕</button></div>
      <label>Día de la semana (opcional)</label>
      <select data-bind="day.weekday" data-di="${di}">${wdOptions(d.weekday)}</select>
      <div style="margin-top:12px">${d.items.map((it, ii) => `<div class="item-row">
        <div class="row"><b class="spacer">${esc(exMap.get(it.exerciseId)?.name ?? '?')}</b>
          <button class="icon-btn" data-act="item-move" data-di="${di}" data-ii="${ii}" data-dir="-1" aria-label="Subir"${ii === 0 ? ' disabled' : ''}>↑</button>
          <button class="icon-btn" data-act="item-move" data-di="${di}" data-ii="${ii}" data-dir="1" aria-label="Bajar"${ii === d.items.length - 1 ? ' disabled' : ''}>↓</button>
          <button class="icon-btn" data-act="item-del" data-di="${di}" data-ii="${ii}" aria-label="Quitar">✕</button></div>
        <div class="grid4">
          <div><label>Series</label><input data-bind="item.sets" data-di="${di}" data-ii="${ii}" inputmode="numeric" value="${esc(inputNum(it.sets))}"></div>
          <div><label>Reps mín.</label><input data-bind="item.repMin" data-di="${di}" data-ii="${ii}" inputmode="numeric" value="${esc(inputNum(it.repMin))}"></div>
          <div><label>Reps máx.</label><input data-bind="item.repMax" data-di="${di}" data-ii="${ii}" inputmode="numeric" value="${esc(inputNum(it.repMax))}"></div>
          <div><label>Subir kg</label><input data-bind="item.increment" data-di="${di}" data-ii="${ii}" inputmode="decimal" value="${esc(inputNum(it.increment))}"></div>
        </div>
        <label>Notas (se ven con el botón ⓘ)</label>
        <textarea data-bind="item.note" data-di="${di}" data-ii="${ii}" rows="2" placeholder="Pausa, técnica, drop set…">${esc(it.note || '')}</textarea></div>`).join('')}</div>
      <button class="btn-ghost btn-small" data-act="item-add" data-di="${di}">+ Añadir ejercicio</button>
    </section>`).join('');
  return `<a class="btn btn-ghost back" href="#rutinas" data-act="edit-cancel">‹ Cancelar</a>
    <h1>${ed.isNew ? 'Nueva rutina' : 'Editar rutina'}</h1>
    <label for="r-name">Nombre</label>
    <input id="r-name" data-bind="name" value="${esc(ed.name)}" placeholder="Ej.: Fuerza otoño">
    <h3>Días</h3>
    ${days}
    <button class="btn btn-block" data-act="day-add">+ Añadir día</button>
    <div style="height:12px"></div>
    <button class="btn btn-primary btn-block btn-big" data-act="edit-save">Guardar rutina</button>`;
}

async function viewCatalog() {
  const exs = (await dbAll('exercises')).sort(byName);
  const item = (e) => `<button class="list-item" data-act="ex-menu" data-id="${e.id}">
      <div class="main"><div class="title">${esc(e.name)}</div>${e.notes ? `<div class="sub">${esc(e.notes)}</div>` : ''}</div>
      <span class="chev">⋯</span></button>`;
  const active = exs.filter((e) => !e.archived).map(item).join('');
  const archived = exs.filter((e) => e.archived).map(item).join('');
  return `<a class="btn btn-ghost back" href="#rutinas">‹ Rutinas</a>
    <h1>Ejercicios</h1>
    <button class="btn btn-block" data-act="ex-new">+ Nuevo ejercicio</button>
    <div style="height:12px"></div>
    ${active ? `<div class="list">${active}</div>` : '<div class="empty">No hay ejercicios.</div>'}
    ${archived ? `<h3>Archivados</h3><div class="list">${archived}</div>` : ''}`;
}

/* ---------- Ajustes ---------- */
async function viewSettings() {
  const [cfg, info, persisted] = await Promise.all([settings(), syncInfo(), getMeta('persisted')]);
  return `<h1>Ajustes</h1>
    <section class="card">
      <h2>Copia en Google</h2>
      <div id="sync-status" class="status ${info.cls}"><span class="dot"></span><span>${esc(info.text)}</span></div>
      <p id="sync-last" class="muted small" style="margin-top:4px">Última copia: ${info.last ? fmtDateTime(info.last) : 'nunca'}</p>
      <label for="cfg-url">URL del script de Google</label>
      <input id="cfg-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url)}">
      <label for="cfg-secret">Clave secreta</label>
      <input id="cfg-secret" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(cfg.secret)}">
      <div class="row" style="margin-top:12px">
        <button class="spacer" data-act="cfg-save">Guardar</button>
        <button class="spacer" data-act="cfg-test">Probar conexión</button>
      </div>
    </section>
    <section class="card stack">
      <button class="btn-primary btn-block" data-act="sync-now">Sincronizar ahora</button>
      <button class="btn-block" data-act="restore">Restaurar desde Google</button>
      <button class="btn-block" data-act="export-csv">Exportar CSV</button>
    </section>
    <p class="muted small center">Almacenamiento ${persisted ? 'persistente' : 'normal'} · versión ${APP_VERSION}</p>`;
}

const VIEWS = { entrenar: viewTrain, historial: viewHistory, rutinas: viewRoutines, ajustes: viewSettings };

/* ---------- Hoja inferior (selector de ejercicios y menús) ---------- */
function openSheet(html) {
  closeSheet();
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.id = 'sheet';
  bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(); });
  document.body.appendChild(bd);
}
function closeSheet() { $('#sheet')?.remove(); ui.picker = null; }

function openPicker({ title, exclude = [], allowCreate = true, onPick }) {
  openSheet(`<h2>${esc(title)}</h2>
    <input id="picker-q" placeholder="${allowCreate ? 'Buscar o crear…' : 'Buscar…'}" autocomplete="off" autocapitalize="sentences">
    <div class="list" id="picker-list" style="margin-top:12px"></div>
    <button class="btn-block" data-act="sheet-close">Cancelar</button>`);
  ui.picker = { onPick, exclude: new Set(exclude), allowCreate };
  fillPicker('');
}
async function fillPicker(q) {
  if (!ui.picker) return;
  const all = (await dbAll('exercises')).filter((e) => !ui.picker.exclude.has(e.id)).sort(byName);
  const nq = norm(q);
  const list = all.filter((e) => (nq ? norm(e.name).includes(nq) : !e.archived));
  let html = list.map((e) => `<button class="list-item" data-act="pick" data-id="${e.id}"><span class="main title">${esc(e.name)}${e.archived ? ' <span class="pill">archivado</span>' : ''}</span></button>`).join('');
  const exact = all.some((e) => norm(e.name) === nq);
  if (ui.picker.allowCreate && nq && !exact) {
    html += `<button class="list-item" data-act="pick-new"><span class="main title" style="color:var(--accent)">+ Crear «${esc(q.trim())}»</span></button>`;
  }
  const box = $('#picker-list');
  if (box) box.innerHTML = html || `<p class="muted small" style="padding:12px 16px;margin:0">${ui.picker.allowCreate ? 'Escribe un nombre para crear el ejercicio.' : 'No hay ejercicios.'}</p>`;
}

/* ==================== 6. Acciones ==================== */
const rowOfEl = (el) => el.closest('.set');

async function ensureSession() {
  const cur = await currentSession();
  if (cur) return { session: cur, created: false };
  const t = ui.train;
  const session = {
    id: uuid(), date: today(), startedAt: Date.now(), routineId: t.routineId, dayId: t.dayId,
    routineName: t.routineName, dayName: t.dayName, status: 'en_curso', synced: false,
    draft: ui.preDraft, updatedAt: Date.now(),
  };
  ui.preDraft = {};
  await dbPut('sessions', session);
  return { session, created: true };
}

// Guarda lo escrito en una serie aún no marcada (para no perderlo si se cierra la app).
async function saveDraft(row, patch) {
  const exId = row.dataset.ex, n = row.dataset.n;
  const session = await currentSession();
  const draft = session ? (session.draft = session.draft || {}) : ui.preDraft;
  const d = (draft[exId] = draft[exId] || {});
  d.vals = d.vals || {};
  d.vals[n] = { w: $('[data-f=w]', row).value, r: $('[data-f=r]', row).value, note: d.vals[n]?.note || '', ...patch };
  if (session) await dbPut('sessions', session);
}

function readRow(row) {
  const w = parseNum($('[data-f=w]', row).value);
  const r = parseNum($('[data-f=r]', row).value);
  if (w === null || w < 0) { toast('Escribe el peso (0 si es sin peso)'); $('[data-f=w]', row).focus(); return null; }
  if (!r || r < 1 || !Number.isInteger(r)) { toast('Escribe las repeticiones'); $('[data-f=r]', row).focus(); return null; }
  return { w, r };
}

async function updateSetFromRow(row) {
  const set = await dbGet('sets', row.dataset.id);
  if (!set) return;
  const v = readRow(row);
  if (!v) { // valor no válido: volver a mostrar lo guardado
    $('[data-f=w]', row).value = inputNum(set.weight); $('[data-f=r]', row).value = inputNum(set.reps); return;
  }
  if (set.weight === v.w && set.reps === v.r) return;
  set.weight = v.w; set.reps = v.r;
  await dbPut('sets', set);
  await markSessionChanged(set.sessionId);
}

async function onSetInput(el) {
  const row = rowOfEl(el);
  if (row.dataset.id) await updateSetFromRow(row);
  else await saveDraft(row, {});
}

const ACTIONS = {
  'pick-day': (el) => { ui.dayId = el.dataset.id; ui.preDraft = {}; rerender(); },

  async check(el) {
    const row = rowOfEl(el);
    if (row.dataset.id) { // desmarcar = borrar la serie
      const set = await dbGet('sets', row.dataset.id);
      await dbDel('sets', row.dataset.id);
      await dbPut('deletions', { id: row.dataset.id, kind: 'set' });
      if (set) await saveDraft(row, { note: set.note || '' });
      delete row.dataset.id; row.classList.remove('done');
      return;
    }
    const v = readRow(row);
    if (!v) return;
    const { session, created } = await ensureSession();
    const n = Number(row.dataset.n);
    const note = session.draft?.[row.dataset.ex]?.vals?.[n]?.note || '';
    const set = { id: uuid(), sessionId: session.id, exerciseId: row.dataset.ex, setNumber: n, weight: v.w, reps: v.r, note, date: session.date };
    if (session.draft?.[row.dataset.ex]?.vals) delete session.draft[row.dataset.ex].vals[n];
    session.updatedAt = Date.now();
    await tx(['sets', 'sessions'], 'readwrite', (t) => { os(t, 'sets').put(set); os(t, 'sessions').put(session); });
    row.dataset.id = set.id; row.classList.add('done');
    document.activeElement?.blur?.();
    if (created) rerender();
  },

  async 'add-set'(el) {
    const exId = el.dataset.ex;
    const session = await currentSession();
    const draft = session ? (session.draft = session.draft || {}) : ui.preDraft;
    draft[exId] = draft[exId] || {};
    draft[exId].rows = Number(el.dataset.rows) + 1;
    if (session) await dbPut('sessions', session);
    rerender();
  },

  async note(el) {
    const row = rowOfEl(el);
    let set = row.dataset.id ? await dbGet('sets', row.dataset.id) : null;
    let current = set ? set.note : '';
    if (!set) {
      const session = await currentSession();
      const draft = session ? session.draft : ui.preDraft;
      current = draft?.[row.dataset.ex]?.vals?.[row.dataset.n]?.note || '';
    }
    const txt = prompt('Nota de la serie', current || '');
    if (txt === null) return;
    if (set) { set.note = txt.trim(); await dbPut('sets', set); await markSessionChanged(set.sessionId); }
    else await saveDraft(row, { note: txt.trim() });
    rerender();
  },

  async finish() {
    const session = await currentSession();
    if (!session) return rerender();
    const sets = await setsOfSession(session.id);
    if (!sets.length) {
      if (!confirm('No has marcado ninguna serie. ¿Descartar este entreno?')) return;
      await dbDel('sessions', session.id);
    } else {
      if (!confirm('¿Terminar el entreno?')) return;
      session.status = 'terminada'; session.synced = false; session.endedAt = Date.now(); session.updatedAt = Date.now();
      delete session.draft;
      await dbPut('sessions', session);
      toast('Entreno guardado 💪');
    }
    ui.dayId = null; ui.preDraft = {};
    window.scrollTo(0, 0);
    await render();
    syncNow();
  },

  async 'del-set'(el) {
    const row = rowOfEl(el);
    if (!confirm('¿Borrar esta serie?')) return;
    const set = await dbGet('sets', row.dataset.id);
    if (!set) return;
    await dbDel('sets', set.id);
    await dbPut('deletions', { id: set.id, kind: 'set' });
    await markSessionChanged(set.sessionId);
    rerender();
  },

  async info(el) {
    const item = ui.train.items[Number(el.dataset.di)];
    const ex = await dbGet('exercises', item.exerciseId);
    openSheet(`<h2>${esc(ex?.name ?? '')}</h2>
      <p class="muted small">Objetivo: ${targetText(item)}</p>
      <div class="card note-text">${esc(item.note)}</div>
      <button class="btn-block" data-act="sheet-close">Cerrar</button>`);
  },

  chart(el) { ui.chart = el.dataset.mode; rerender(); },
  'hist-all'() { ui.histAll = true; rerender(); },

  /* --- Rutinas --- */
  'new-routine'() {
    ui.edit = { isNew: true, id: uuid(), name: '', days: [{ id: uuid(), name: 'D1', weekday: null, items: [] }] };
    location.hash = '#rutinas/nueva';
  },
  async 'dup-routine'(el) {
    const r = await dbGet('routines', el.dataset.id);
    ui.edit = {
      isNew: true, id: uuid(), name: `${r.name} (copia)`,
      days: r.days.map((d) => ({ ...d, id: uuid(), items: d.items.map((i) => ({ ...i })) })),
    };
    location.hash = '#rutinas/nueva';
  },
  async 'archive-routine'(el) {
    const r = await dbGet('routines', el.dataset.id);
    if (!confirm(`¿Archivar «${r.name}»? Se podrá consultar, pero no editar.`)) return;
    r.endDate = today();
    await dbPut('routines', touch(r));
    scheduleSync(); rerender();
  },
  'edit-cancel'() { ui.edit = null; },
  'day-add'() {
    ui.edit.days.push({ id: uuid(), name: `D${ui.edit.days.length + 1}`, weekday: null, items: [] });
    rerender();
  },
  'day-del'(el) {
    const d = ui.edit.days[el.dataset.di];
    if (!confirm(`¿Quitar «${d.name}»? El historial de sus ejercicios se conserva.`)) return;
    ui.edit.days.splice(el.dataset.di, 1); rerender();
  },
  'item-add'(el) {
    const day = ui.edit.days[el.dataset.di];
    openPicker({
      title: 'Añadir ejercicio', exclude: day.items.map((i) => i.exerciseId),
      onPick: (id) => { day.items.push(newItem(id)); rerender(); },
    });
  },
  'item-del'(el) { ui.edit.days[el.dataset.di].items.splice(el.dataset.ii, 1); rerender(); },
  'item-move'(el) {
    const items = ui.edit.days[el.dataset.di].items;
    const i = Number(el.dataset.ii), j = i + Number(el.dataset.dir);
    [items[i], items[j]] = [items[j], items[i]]; rerender();
  },
  async 'edit-save'() {
    const ed = ui.edit;
    ed.name = ed.name.trim();
    if (!ed.name) { toast('Ponle un nombre a la rutina'); $('#r-name').focus(); return; }
    if (!ed.days.length) { toast('Añade al menos un día'); return; }
    ed.days.forEach((d, i) => {
      d.name = d.name.trim() || `D${i + 1}`;
      d.items.forEach((it) => {
        it.sets = Math.max(1, Math.round(it.sets || 3));
        it.repMin = Math.max(1, Math.round(it.repMin || 8));
        it.repMax = Math.max(it.repMin, Math.round(it.repMax || it.repMin));
        it.increment = it.increment === null || it.increment === undefined || it.increment < 0 ? 2.5 : round2(it.increment);
        it.note = (it.note || '').trim();
      });
    });
    const days = ed.days.map(({ id, name, weekday, items }) => ({ id, name, weekday: weekday ?? null, items }));
    if (ed.isNew) {
      const active = await activeRoutine();
      if (active && !confirm(`Al guardar, «${active.name}» se archivará y esta pasará a ser la activa. ¿Continuar?`)) return;
      await tx(['routines'], 'readwrite', (t) => {
        if (active) { active.endDate = today(); os(t, 'routines').put(touch(active)); }
        os(t, 'routines').put(touch({ id: ed.id, name: ed.name, startDate: today(), endDate: null, days }));
      });
    } else {
      const r = await dbGet('routines', ed.id);
      r.name = ed.name; r.days = days;
      await dbPut('routines', touch(r));
    }
    ui.edit = null; ui.dayId = null;
    toast('Rutina guardada');
    scheduleSync();
    location.hash = '#rutinas';
  },

  /* --- Selector de ejercicios --- */
  async pick(el) {
    const ex = await dbGet('exercises', el.dataset.id);
    if (ex.archived) { ex.archived = false; await dbPut('exercises', touch(ex)); }
    const cb = ui.picker.onPick; closeSheet(); cb(ex.id);
  },
  async 'pick-new'() {
    const name = $('#picker-q').value.trim();
    if (!name) return;
    const ex = touch({ id: uuid(), name, notes: '', archived: false });
    await dbPut('exercises', ex);
    scheduleSync();
    const cb = ui.picker.onPick; closeSheet(); cb(ex.id);
  },
  'sheet-close'() { closeSheet(); },

  /* --- Catálogo --- */
  async 'ex-new'() {
    const name = (prompt('Nombre del nuevo ejercicio') || '').trim();
    if (!name) return;
    const dup = (await dbAll('exercises')).find((e) => norm(e.name) === norm(name));
    if (dup) { alert(`Ya existe «${dup.name}».`); return; }
    await dbPut('exercises', touch({ id: uuid(), name, notes: '', archived: false }));
    scheduleSync(); rerender();
  },
  async 'ex-menu'(el) {
    const ex = await dbGet('exercises', el.dataset.id);
    openSheet(`<h2>${esc(ex.name)}</h2><div class="stack">
      <button class="btn-block" data-act="ex-rename" data-id="${ex.id}">Renombrar</button>
      <button class="btn-block" data-act="ex-notes" data-id="${ex.id}">Notas</button>
      <button class="btn-block" data-act="ex-merge" data-id="${ex.id}">Fusionar con otro…</button>
      <button class="btn-block" data-act="ex-archive" data-id="${ex.id}">${ex.archived ? 'Recuperar del archivo' : 'Archivar'}</button>
      <button class="btn-block btn-ghost" data-act="sheet-close">Cancelar</button></div>`);
  },
  async 'ex-rename'(el) {
    const ex = await dbGet('exercises', el.dataset.id);
    const name = (prompt('Nuevo nombre (el historial se mantiene)', ex.name) || '').trim();
    if (!name || name === ex.name) return;
    const dup = (await dbAll('exercises')).find((e) => e.id !== ex.id && norm(e.name) === norm(name));
    if (dup) { alert(`Ya existe «${dup.name}». Si son el mismo ejercicio, usa «Fusionar».`); return; }
    ex.name = name;
    await dbPut('exercises', touch(ex));
    closeSheet(); scheduleSync(); rerender(); toast('Renombrado');
  },
  async 'ex-notes'(el) {
    const ex = await dbGet('exercises', el.dataset.id);
    const notes = prompt('Notas del ejercicio', ex.notes || '');
    if (notes === null) return;
    ex.notes = notes.trim();
    await dbPut('exercises', touch(ex));
    closeSheet(); scheduleSync(); rerender();
  },
  async 'ex-merge'(el) {
    const from = await dbGet('exercises', el.dataset.id);
    openPicker({
      title: `Fusionar «${from.name}» con…`, exclude: [from.id], allowCreate: false,
      onPick: (intoId) => serial(async () => {
        const into = await dbGet('exercises', intoId);
        if (!confirm(`Todas las series de «${from.name}» pasarán a «${into.name}» y «${from.name}» desaparecerá. No se puede deshacer. ¿Continuar?`)) return;
        await mergeExercises(from.id, into.id);
        toast('Ejercicios fusionados'); rerender();
      }),
    });
  },
  async 'ex-archive'(el) {
    const ex = await dbGet('exercises', el.dataset.id);
    ex.archived = !ex.archived;
    await dbPut('exercises', touch(ex));
    closeSheet(); scheduleSync(); rerender();
  },

  /* --- Ajustes --- */
  async 'cfg-save'() {
    await setMeta('settings', { url: $('#cfg-url').value.trim(), secret: $('#cfg-secret').value.trim() });
    await setMeta('syncError', null);
    toast('Guardado'); refreshSyncUI();
  },
  async 'cfg-test'(el) {
    const cfg = { url: $('#cfg-url').value.trim(), secret: $('#cfg-secret').value.trim() };
    await setMeta('settings', cfg);
    el.disabled = true; el.textContent = 'Probando…';
    try {
      const r = await callScript({ action: 'ping' }, cfg);
      await setMeta('syncError', null);
      toast(`Conexión correcta ✓ ${r.hoja ? '(' + r.hoja + ')' : ''}`, 3500);
      syncNow();
    } catch (e) {
      await setMeta('syncError', { msg: e.message, kind: e.kind || 'server', at: Date.now() });
      alert('No funciona: ' + e.message);
    }
    finally { el.disabled = false; el.textContent = 'Probar conexión'; refreshSyncUI(); }
  },
  async 'sync-now'(el) {
    el.disabled = true; el.textContent = 'Sincronizando…';
    const r = await syncNow({ force: true });
    el.disabled = false; el.textContent = 'Sincronizar ahora';
    if (r.error) alert('No se pudo sincronizar: ' + r.error.message);
    else if (r.skipped === 'config') alert('Primero escribe la URL y la clave, y pulsa Guardar.');
    else toast('Sincronizado ✓');
  },
  async restore(el) {
    const counts = await pendingCounts();
    const live = await currentSession();
    let msg = 'Se borrarán los datos de este móvil y se cargarán los de Google. ¿Continuar?';
    if (counts.sessions || counts.other || live) msg = '⚠ Hay cambios en este móvil que aún no están en Google y se perderán. ' + msg;
    if (!confirm(msg)) return;
    el.disabled = true; el.textContent = 'Restaurando…';
    try {
      const r = await restoreFromGoogle();
      ui.dayId = null; ui.preDraft = {}; ui.edit = null;
      alert(`Restaurado: ${r.exercises} ejercicios, ${r.routines} rutinas, ${r.sessions} sesiones.`);
      rerender();
    } catch (e) { alert('No se pudo restaurar: ' + e.message); }
    finally { el.disabled = false; el.textContent = 'Restaurar desde Google'; }
  },
  async 'export-csv'() { await exportCsv(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'A') e.preventDefault();
  serial(() => fn(el, e));
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.closest('.set')) serial(() => onSetInput(el));
  else if (el.dataset.bind) onBind(el);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'picker-q') fillPicker(e.target.value);
  else if (e.target.dataset.bind) onBind(e.target);
});
// Al tocar un campo de serie, seleccionar su contenido para sobrescribirlo de un toque.
document.addEventListener('focusin', (e) => {
  if (e.target.matches('.set input')) setTimeout(() => { try { e.target.setSelectionRange(0, 99); } catch { /* */ } }, 0);
});

function onBind(el) {
  const ed = ui.edit;
  if (!ed) return;
  const di = Number(el.dataset.di), ii = Number(el.dataset.ii), v = el.value;
  const key = el.dataset.bind;
  if (key === 'name') ed.name = v;
  else if (key === 'day.name') ed.days[di].name = v;
  else if (key === 'day.weekday') ed.days[di].weekday = v === '' ? null : Number(v);
  else if (key === 'item.note') ed.days[di].items[ii].note = v;
  else if (key.startsWith('item.')) ed.days[di].items[ii][key.slice(5)] = parseNum(v);
}

/* ==================== 7. Arranque ==================== */
async function start() {
  await seedIfNeeded();
  window.addEventListener('hashchange', () => render());
  await render();
  try {
    if (navigator.storage?.persist) {
      const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      await setMeta('persisted', !!persisted);
    }
  } catch { /* no disponible */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW', e));
  syncNow();
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
}

// Acceso para las pruebas automáticas (no afecta al uso normal).
window.__gym = { dbAll, dbGet, dbPut, tx, os, uuid, today, isoDate, setMeta, getMeta, syncNow, restoreFromGoogle, mergeExercises, render, exportCsv, ui };

start().catch((e) => {
  console.error(e);
  $('#view').innerHTML = `<div class="card"><h2>No se pudo iniciar</h2><p class="muted small">${esc(e.message)}</p></div>`;
});
