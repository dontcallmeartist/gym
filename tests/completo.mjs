import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
const OUT = new URL('./capturas/', import.meta.url).pathname.slice(1);
mkdirSync(OUT, { recursive: true });
const APP = 'http://localhost:8080/';
const MOCK = 'http://localhost:8090';
const KEY = 'clave-de-prueba';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => { if (cond) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg, extra); } };
const dump = async () => (await fetch(MOCK + '/__dump')).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(200); } return null; }

await fetch(MOCK + '/__reset');
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push(m.text()); });
const answers = [];
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? answers.shift() : undefined));
const g = (fn, arg) => page.evaluate(fn, arg);
const card = (name) => page.locator('section.card').filter({ has: page.getByRole('heading', { name, exact: true }) });
async function doSet(name, n, w, r) {
  const row = card(name).locator(`.set[data-n="${n}"]`);
  await row.locator('[data-f=w]').fill(String(w));
  await row.locator('[data-f=r]').fill(String(r));
  await row.locator('[data-act=check]').click();
  await row.and(page.locator('.done')).waitFor();
}
async function go(hash) { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(250); }
async function finish() { await page.click('[data-act=finish]'); await page.waitForSelector('[data-act=finish]', { state: 'detached' }); }

// ---------- 1. Primer uso y conexión ----------
console.log('\n1. Configurar conexión');
await page.clock.setFixedTime(new Date('2026-11-02T18:00:00'));
await page.goto(APP); await page.waitForSelector('h1');
await page.evaluate(() => navigator.serviceWorker.ready);
ok((await page.textContent('h1')) === 'D1 Empuje', 'el lunes propone el Día 1 (día de la semana asignado)');
await go('#ajustes');
await page.fill('#cfg-url', MOCK + '/exec');
await page.fill('#cfg-secret', 'clave-mala');
await page.click('[data-act=cfg-test]');
await page.waitForTimeout(800);
ok((await page.textContent('#sync-status')).includes('Clave incorrecta'), 'clave incorrecta → muestra error');
await page.fill('#cfg-secret', KEY);
await page.click('[data-act=cfg-test]');
ok(await waitFor(async () => (await page.textContent('#toast')).includes('Conexión correcta')), 'Probar conexión → correcta');
let d = await dump();
ok(['Registros', 'Ejercicios', 'Rutinas', 'Progreso'].every((n) => d.sheets[n]) && !d.sheets['Hoja 1'], 'el script crea las 4 pestañas y quita "Hoja 1"');
ok(d.sheets.Ejercicios.length === 1, 'los datos de ejemplo NO se suben sin usarlos');

// ---------- 2. Sesión completa sin conexión ----------
console.log('\n2. Entreno sin conexión + sesión que sobrevive a cerrar la app');
await ctx.setOffline(true);
await go('#entrenar');
for (let n = 1; n <= 3; n++) await doSet('Press banca', n, 60, 12);
await doSet('Press militar', 1, 40, 10);
await doSet('Press militar', 2, '40', 9);
await page.reload(); await page.waitForSelector('h1'); // "cerrar la app" (sin conexión)
ok(await page.locator('.set.done').count() === 5 && await page.locator('[data-act=finish]').count() === 1, 'tras recargar sin conexión, la sesión en curso sigue ahí (5 series)');
await doSet('Press militar', 3, 40, 8);
for (let n = 1; n <= 3; n++) await doSet('Fondos', n, 0, 12);
await page.screenshot({ path: OUT + '2-entreno-en-curso.png', fullPage: true });
await finish();
await go('#ajustes');
ok((await page.textContent('#sync-status')).includes('1 sesión pendiente'), 'sin conexión → "1 sesión pendiente"', await page.textContent('#sync-status'));
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
d = await waitFor(async () => { const x = await dump(); return x.sheets.Registros.length === 10 ? x : null; });
ok(d, 'al volver la conexión se envían las 9 series');
await page.click('[data-act=sync-now]'); await page.waitForTimeout(800);
await page.click('[data-act=sync-now]'); await page.waitForTimeout(800);
d = await dump();
const ids = d.sheets.Registros.slice(1).map((r) => r[0]);
ok(ids.length === 9 && new Set(ids).size === 9, 'sincronizar otras 2 veces no crea duplicados');
ok(d.preflights === 0, 'ninguna petición OPTIONS (CORS correcto)');
ok((await page.textContent('#sync-status')).includes('Todo sincronizado'), 'estado: Todo sincronizado', await page.textContent('#sync-status') + JSON.stringify(await g(async () => ({ex: (await __gym.dbAll('exercises')).filter(e=>e.dirty).map(e=>e.name), r: (await __gym.dbAll('routines')).filter(e=>e.dirty).map(e=>e.name), del: (await __gym.dbAll('deletions')).length}))));
ok(d.sheets.Registros[1][1] === '2026-11-02' && d.sheets.Registros[0].join(',').startsWith('id_serie,fecha,rutina,día,ejercicio_id,ejercicio,serie,peso,reps,nota,id_sesion'), 'columnas de Registros según la especificación');

// ---------- 3. Progresión ----------
console.log('\n3. Doble progresión y prerrelleno');
await page.clock.setFixedTime(new Date('2026-11-09T18:00:00'));
await go('#rutinas'); await go('#entrenar');
ok((await card('Press banca').locator('.hint').textContent()) === '↑ Sube a 62,5 kg', 'Press banca 3×12 (máximo) → "↑ Sube a 62,5 kg"');
ok((await card('Press banca').locator('[data-f=w]').first().inputValue()) === '62,5', 'peso prerrellenado con la sugerencia (62,5)');
ok((await card('Press militar').locator('.hint').textContent()).includes('Mantén 40 kg'), 'Press militar sin llegar a 12 → "Mantén 40 kg"');
ok((await card('Press militar').locator('[data-f=r]').nth(1).inputValue()) === '9', 'reps prerrellenadas con lo de la última vez');
ok((await card('Press banca').locator('.last').textContent()).includes('60 × 12 · 60 × 12 · 60 × 12'), 'muestra lo de la última vez con fecha');
await page.screenshot({ path: OUT + '3-entrenar-progresion.png', fullPage: true });
await doSet('Press banca', 1, '62,5', 9);
await doSet('Press banca', 2, '62,5', 8);
await doSet('Press banca', 3, '62,5', 8);
for (let n = 1; n <= 3; n++) await doSet('Press militar', n, 40, 12 - n);
await finish();
d = await waitFor(async () => { const x = await dump(); return x.sheets.Registros.length === 16 ? x : null; });
ok(d, 'segunda sesión sincronizada (15 series en total)');
ok(d.sheets.Registros.some((r) => r[7] === 62.5), 'los decimales llegan como número (62,5)');

// ---------- 4. Editar sesión pasada ----------
console.log('\n4. Editar una sesión pasada');
const ses1 = await g(async () => (await __gym.dbAll('sessions')).find((s) => s.date === '2026-11-02').id);
await go('#historial/ses/' + ses1);
const pm = card('Press militar').locator('.set[data-n="3"]');
const editedId = await pm.getAttribute('data-id');
await pm.locator('[data-f=r]').fill('7');
await pm.locator('[data-f=r]').blur();
await page.screenshot({ path: OUT + '4-editar-sesion.png', fullPage: true });
d = await waitFor(async () => { const x = await dump(); const row = x.sheets.Registros.find((r) => r[0] === editedId); return row && row[8] === 7 ? x : null; });
ok(d && d.sheets.Registros.length === 16, 'la fila se actualiza en la hoja (sin duplicar)');

// ---------- 5. Renombrar ----------
console.log('\n5. Renombrar un ejercicio');
await go('#rutinas/catalogo');
await page.locator('[data-act=ex-menu]', { hasText: 'Press banca' }).click();
answers.push('Press de banca');
await page.click('[data-act=ex-rename]');
await page.waitForTimeout(300);
await go('#historial');
const hist = await page.textContent('.list');
ok(hist.includes('Press de banca') && !hist.includes('Press banca'), 'en Historial aparece con el nombre nuevo');
const pbId = await g(async () => (await __gym.dbAll('exercises')).find((e) => e.name === 'Press de banca').id);
await go('#historial/ex/' + pbId);
ok((await page.textContent('h3')).includes('Sesiones (2)'), 'el historial sigue unido (2 sesiones)');
d = await waitFor(async () => { const x = await dump(); const rows = x.sheets.Registros.filter((r) => r[4] === pbId); return rows.length === 6 && rows.every((r) => r[5] === 'Press de banca') ? x : null; });
ok(d, 'en la hoja se renombra en todas las filas del historial');
ok(d && d.sheets.Ejercicios.some((r) => r[0] === pbId && r[1] === 'Press de banca'), 'y en la pestaña Ejercicios');

console.log('\n5b. Favoritos');
await go('#historial');
await page.locator('.list-item', { has: page.locator('.title', { hasText: /^Press militar$/ }) }).locator('[data-act=fav]').click();
await page.waitForTimeout(300);
ok((await page.locator('h3').first().textContent()).includes('Favoritos'), 'aparece la sección Favoritos');
ok((await page.locator('.list').first().textContent()).includes('Press militar') && !(await page.locator('.list').first().textContent()).includes('Press de banca'), 'Press militar sube a Favoritos (y solo él)');
ok(await page.locator('.list').nth(1).locator('.title', { hasText: /^Press militar$/ }).count() === 0, 'y no se repite en "Todos"');
await page.screenshot({ path: OUT + '5b-favoritos.png', fullPage: true });
const pmId = await g(async () => (await __gym.dbAll('exercises')).find((e) => e.name === 'Press militar').id);
await go('#historial/ex/' + pmId);
ok((await page.textContent('[data-act=fav]')).trim() === '★', 'la estrella también aparece marcada en el detalle del ejercicio');
d = await waitFor(async () => { const x = await dump(); return x.sheets.Ejercicios[0][4] === 'favorito' && x.sheets.Ejercicios.some((r) => r[0] === pmId && r[4] === 'Sí') ? x : null; });
ok(d, 'el favorito se guarda en la hoja (columna favorito)');

// ---------- 6. Cambiar de rutina conservando 2 ejercicios ----------
console.log('\n6. Rutina nueva que conserva 2 ejercicios');
await page.clock.setFixedTime(new Date('2026-11-12T18:00:00'));
await go('#rutinas');
await page.click('[data-act=new-routine]');
await page.fill('#r-name', 'Rutina nueva');
const addEx = async (q, act = 'pick') => {
  await page.click('[data-act=item-add]');
  await page.fill('#picker-q', q);
  await page.waitForTimeout(200);
  if (act === 'pick') await page.locator('#picker-list [data-act=pick]').first().click();
  else await page.click('#picker-list [data-act=pick-new]');
  await page.waitForTimeout(200);
};
await addEx('press de');
await page.fill('textarea[data-bind="item.note"]', 'Pausa de 1 s.\nRetracción escapular.');
await addEx('militar');
ok((await page.inputValue('textarea[data-bind="item.note"] >> nth=0')).startsWith('Pausa de 1 s.'), 'la nota se conserva al añadir más ejercicios');
await page.click('[data-act=item-add]'); await page.fill('#picker-q', 'Aperturas'); await page.waitForTimeout(200);
await page.screenshot({ path: OUT + '6-selector.png' });
await page.click('#picker-list [data-act=pick-new]'); await page.waitForTimeout(200);
await page.screenshot({ path: OUT + '6-editor.png', fullPage: true });
await page.click('[data-act=edit-save]');
await page.waitForTimeout(400);
const rs = await g(async () => (await __gym.dbAll('routines')).map((r) => ({ name: r.name, end: r.endDate })));
ok(rs.find((r) => r.name === 'Rutina de ejemplo').end === '2026-11-12' && rs.find((r) => r.name === 'Rutina nueva').end === null, 'la anterior queda archivada y la nueva activa');
await go('#entrenar');
ok((await card('Press de banca').locator('.last').textContent()).includes('62,5 × 9'), 'Press de banca conserva su historial en la rutina nueva');
ok((await card('Press de banca').locator('.hint').textContent()).includes('Mantén 62,5 kg'), 'y su sugerencia de progresión');
ok((await card('Press militar').locator('.hint').textContent()).includes('Mantén 40 kg'), 'Press militar también');
ok((await card('Aperturas').locator('.last').textContent()).includes('Primera vez'), 'el ejercicio nuevo empieza de cero');
ok(await card('Press de banca').locator('[data-act=info]').count() === 1 && await card('Aperturas').locator('[data-act=info]').count() === 0, 'botón ⓘ solo en ejercicios con nota');
await card('Press de banca').locator('[data-act=info]').click();
ok((await page.textContent('.note-text')).includes('Retracción escapular'), 'ⓘ muestra la nota de la rutina');
await page.screenshot({ path: OUT + '6-nota.png' });
await page.click('[data-act=sheet-close]');
await page.screenshot({ path: OUT + '6-entrenar-con-i.png' });
d = await waitFor(async () => { const x = await dump(); const est = new Set(x.sheets.Rutinas.slice(1).map((r) => r[1] + ':' + r[4])); return est.has('Rutina de ejemplo:Archivada') && est.has('Rutina nueva:Activa') ? x : null; });
ok(d, 'la pestaña Rutinas muestra la archivada y la activa');
ok(d && d.sheets.Rutinas[0][16] === 'notas' && d.sheets.Rutinas.some((r) => r[16] === 'Pausa de 1 s.\nRetracción escapular.'), 'la nota llega a la columna "notas" de la hoja');
await go('#rutinas/ver/' + (await g(async () => (await __gym.dbAll('routines')).find((r) => r.endDate).id)));
ok(await page.locator('[data-act=dup-routine]').count() === 1 && await page.locator('a[href^="#rutinas/editar"]').count() === 0, 'la rutina archivada se puede consultar y duplicar, no editar');

// ---------- 7. Fusionar ----------
console.log('\n7. Fusionar ejercicios duplicados');
await go('#rutinas/catalogo');
answers.push('Fondos en paralelas');
await page.click('[data-act=ex-new]'); await page.waitForTimeout(300);
await page.locator('[data-act=ex-menu]').filter({ has: page.locator('.title', { hasText: /^Fondos$/ }) }).click();
await page.click('[data-act=ex-merge]');
await page.locator('#picker-list [data-act=pick]', { hasText: 'Fondos en paralelas' }).click();
await page.waitForTimeout(500);
const exNames = await g(async () => (await __gym.dbAll('exercises')).map((e) => e.name));
const fpId = await g(async () => (await __gym.dbAll('exercises')).find((e) => e.name === 'Fondos en paralelas').id);
const fpSets = await g(async (id) => (await __gym.dbAll('sets')).filter((s) => s.exerciseId === id).length, fpId);
ok(!exNames.includes('Fondos') && fpSets === 3, 'Fondos desaparece y sus 3 series pasan a "Fondos en paralelas"');
d = await waitFor(async () => { const x = await dump(); return x.sheets.Registros.filter((r) => r[4] === fpId && r[5] === 'Fondos en paralelas').length === 3 && !x.sheets.Ejercicios.some((r) => r[1] === 'Fondos') ? x : null; });
ok(d, 'en la hoja también');

// ---------- 8. Aviso de 7 días ----------
console.log('\n8. Aviso de más de 7 días sin sincronizar');
await page.waitForTimeout(4000); // dejar terminar las sincronizaciones programadas
await g(() => __gym.setMeta('lastSync', Date.now() - 9 * 86400000));
await go('#historial'); await go('#entrenar');
ok((await page.textContent('#banner')).includes('Hace 9 días'), 'muestra el aviso', await page.textContent('#banner'));
await page.screenshot({ path: OUT + '8-aviso.png' });
await go('#ajustes'); await page.click('[data-act=sync-now]'); await page.waitForTimeout(800);
ok(await page.locator('#banner').isHidden(), 'desaparece al sincronizar');

// ---------- 9. CSV ----------
console.log('\n9. Exportar CSV');
await g(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export-csv]')]);
const csvPath = OUT + 'export.csv';
await dl.saveAs(csvPath);
const buf = readFileSync(csvPath);
const csv = buf.toString('utf8');
ok(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'empieza con BOM UTF-8');
ok(csv.includes('Fecha;Rutina;Día;Ejercicio;Serie;Peso (kg);Reps') && csv.includes(';62,5;') && csv.includes('02/11/2026'), 'separador ;, coma decimal y fecha dd/mm/aaaa');
ok(csv.split('\r\n').filter(Boolean).length === 16, '15 series + cabecera');

// ---------- 10. Borrar datos y restaurar ----------
console.log('\n10. Borrar los datos locales y restaurar desde Google');
const snap = () => g(async () => {
  const pick = (o, k) => Object.fromEntries(k.map((x) => [x, o[x]]));
  const sort = (a) => a.sort((x, y) => x.id.localeCompare(y.id));
  return JSON.stringify({
    ex: sort((await __gym.dbAll('exercises')).filter((e) => !e.seed).map((e) => ({ ...pick(e, ['id', 'name', 'notes', 'archived']), favorite: !!e.favorite }))),
    r: sort((await __gym.dbAll('routines')).map((r) => ({ ...pick(r, ['id', 'name', 'startDate', 'endDate']), days: r.days.map((d) => ({ id: d.id, name: d.name, weekday: d.weekday, items: d.items })) }))),
    s: sort((await __gym.dbAll('sessions')).map((s) => pick(s, ['id', 'date', 'routineId', 'dayId', 'status']))),
    sets: sort((await __gym.dbAll('sets')).map((s) => pick(s, ['id', 'sessionId', 'exerciseId', 'setNumber', 'weight', 'reps', 'note', 'date']))),
  });
});
// Una nota con caracteres delicados para comprobar que sobrevive
await g(async () => { const s = (await __gym.dbAll('sets'))[0]; s.note = '=rodilla; "ojo"'; await __gym.dbPut('sets', s); const ses = await __gym.dbGet('sessions', s.sessionId); ses.synced = false; ses.updatedAt = Date.now(); await __gym.dbPut('sessions', ses); });
await page.click('[data-act=sync-now]'); await page.waitForTimeout(1000);
const before = await snap();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Storage.clearDataForOrigin', { origin: 'http://localhost:8080', storageTypes: 'indexeddb' });
await page.reload(); await page.waitForSelector('h1');
ok((await g(async () => (await __gym.dbAll('sets')).length)) === 0, 'datos locales borrados (app como recién instalada)');
await go('#ajustes');
await page.fill('#cfg-url', MOCK + '/exec'); await page.fill('#cfg-secret', KEY);
await page.click('[data-act=cfg-test]'); await page.waitForTimeout(1200);
d = await dump();
ok(!d.sheets.Rutinas.slice(1).some((r) => r[1] === 'Rutina de ejemplo' && r[4] === 'Activa'), 'configurar el móvil nuevo no sube la rutina de ejemplo nueva');
await page.click('[data-act=restore]'); await page.waitForTimeout(1500);
const after = await snap();
ok(before === after, 'todo vuelve igual: catálogo, rutinas, sesiones y series', before === after ? '' : `\n antes: ${before.slice(0, 300)}\n despues: ${after.slice(0, 300)}`);
await go('#entrenar');
ok((await card('Press de banca').locator('.hint').textContent()).includes('Mantén 62,5 kg'), 'la progresión sigue funcionando tras restaurar');

// ---------- 11. Un año de datos falsos ----------
console.log('\n11. Rendimiento con un año de datos');
await g(async () => {
  const { uuid, isoDate, tx, os } = __gym;
  const r = (await __gym.dbAll('routines')).find((x) => x.name === 'Rutina de ejemplo');
  const sessions = [], sets = [];
  const start = new Date('2025-10-27');
  for (let w = 0; w < 52; w++) for (const [k, day] of r.days.entries()) {
    const date = new Date(start); date.setDate(start.getDate() + w * 7 + k * 2);
    const id = uuid(), ds = isoDate(date);
    sessions.push({ id, date: ds, startedAt: date.getTime(), routineId: r.id, dayId: day.id, status: 'terminada', synced: false, updatedAt: Date.now() });
    day.items.forEach((it, i) => { for (let n = 1; n <= 4; n++) sets.push({ id: uuid(), sessionId: id, exerciseId: it.exerciseId, setNumber: n, weight: 40 + i * 10 + Math.floor(w / 4) * 2.5, reps: 8 + ((w + n) % 5), note: '', date: ds }); });
  }
  await tx(['sessions', 'sets'], 'readwrite', (t) => { sessions.forEach((s) => os(t, 'sessions').put(s)); sets.forEach((s) => os(t, 'sets').put(s)); });
  window.__fake = { sessions: sessions.length, sets: sets.length };
});
const fake = await g(() => window.__fake);
console.log(`  (generadas ${fake.sessions} sesiones y ${fake.sets} series)`);
const timeRender = async (hash) => g(async (h) => { location.hash = h; await new Promise((r) => setTimeout(r, 0)); const t = performance.now(); await __gym.render(); return Math.round(performance.now() - t); }, hash);
const sentId = await g(async () => (await __gym.dbAll('exercises')).find((e) => e.name === 'Sentadilla').id);
const times = { entrenar: await timeRender('#entrenar'), historial: await timeRender('#historial'), grafica: await timeRender('#historial/ex/' + sentId), rutinas: await timeRender('#rutinas') };
console.log('  tiempos de pantalla (ms):', JSON.stringify(times));
ok(Object.values(times).every((t) => t < 300), 'todas las pantallas cargan en menos de 0,3 s');
await go('#historial/ex/' + sentId); await page.screenshot({ path: OUT + '11-grafica.png', fullPage: true });
await go('#historial/ex/' + sentId);
await page.click('[data-act=chart][data-mode=vol]'); await page.waitForTimeout(200);
await page.screenshot({ path: OUT + '11-grafica-volumen.png' });
let t0 = Date.now();
const res = await g(() => __gym.syncNow({ force: true }));
console.log(`  sincronizar ${fake.sessions} sesiones: ${Date.now() - t0} ms`, res.error ? res.error.message : '');
d = await dump();
ok(d.sheets.Registros.length - 1 === fake.sets + 15, 'todas las series del año en la hoja', `${d.sheets.Registros.length - 1}`);
ok(d.sheets.Progreso.length > 100, `Progreso resumido por semana (${d.sheets.Progreso.length - 1} filas)`);
t0 = Date.now();
const before2 = await snap();
await g(() => __gym.restoreFromGoogle());
console.log(`  restaurar todo: ${Date.now() - t0} ms`);
ok(before2 === (await snap()), 'restaurar un año de datos deja todo igual');

// Capturas finales
await page.emulateMedia({ colorScheme: 'dark' });
await go('#ajustes'); await page.screenshot({ path: OUT + '12-ajustes-dark.png' });
await go('#entrenar'); await page.screenshot({ path: OUT + '12-entrenar-dark.png' });

console.log('\nErrores de la página:', errors.length ? errors : 'ninguno');
console.log(`\nRESULTADO: ${pass} correctas, ${fail} fallidas`);
await browser.close();
