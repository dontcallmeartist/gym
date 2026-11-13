/**
 * Gym – script para Google Sheets (copia de seguridad de la app).
 *
 * CÓMO INSTALARLO (explicado paso a paso en el README):
 *   1. En una hoja de cálculo nueva: Extensiones → Apps Script.
 *   2. Borra lo que haya y pega este archivo entero.
 *   3. Cambia la clave de abajo por una inventada por ti (sin espacios).
 *   4. Implementar → Nueva implementación → Tipo: Aplicación web
 *      · Ejecutar como: Yo   · Quién tiene acceso: Cualquier usuario
 *   5. Copia la URL que termina en /exec y pégala en Ajustes de la app,
 *      junto con la misma clave.
 *
 * El script crea y mantiene solo las pestañas: Registros, Ejercicios, Rutinas y Progreso.
 * No borres ni cambies el orden de las columnas (sí puedes añadir gráficas o pestañas tuyas).
 */
const CLAVE_SECRETA = 'CAMBIA_ESTA_CLAVE';

const COLUMNAS = {
  Registros: ['id_serie', 'fecha', 'rutina', 'día', 'ejercicio_id', 'ejercicio', 'serie', 'peso', 'reps', 'nota', 'id_sesion', 'id_rutina', 'id_dia'],
  Ejercicios: ['ejercicio_id', 'nombre', 'notas', 'archivado'],
  Rutinas: ['id_rutina', 'rutina', 'inicio', 'fin', 'estado', 'id_dia', 'orden_dia', 'día', 'día_semana', 'orden', 'ejercicio_id', 'ejercicio', 'series', 'reps_min', 'reps_max', 'incremento_kg', 'notas'],
  Progreso: ['ejercicio', 'semana (lunes)', 'peso_máx_kg', 'volumen_kg', 'series'],
};
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/*
 * Nota sobre CORS: la app envía las peticiones como POST con
 * "Content-Type: text/plain" (una "petición simple"). Así el navegador no hace
 * la petición previa OPTIONS, que Apps Script no sabe contestar. Por eso aquí el
 * JSON se lee como texto desde e.postData.contents. La respuesta de Apps Script
 * llega tras una redirección a script.googleusercontent.com, que sí permite
 * leerla desde otra web (como GitHub Pages).
 */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return responder({ ok: false, error: 'Petición no válida' }); }
  if (CLAVE_SECRETA === 'CAMBIA_ESTA_CLAVE' || !CLAVE_SECRETA) return responder({ ok: false, error: 'Falta cambiar CLAVE_SECRETA en el script' });
  if (body.secret !== CLAVE_SECRETA) return responder({ ok: false, error: 'Clave incorrecta' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // evita que dos envíos escriban a la vez
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    prepararHojas(ss);
    if (body.action === 'ping') return responder({ ok: true, hoja: ss.getName() });
    if (body.action === 'sync') { sincronizar(ss, body); return responder({ ok: true }); }
    if (body.action === 'restore') return responder(Object.assign({ ok: true }, restaurar(ss)));
    return responder({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return responder({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('El script de Gym funciona. Los datos se envían desde la app.');
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Hojas ---------- */
function prepararHojas(ss) {
  Object.keys(COLUMNAS).forEach(function (nombre) {
    let sh = ss.getSheetByName(nombre);
    if (!sh) sh = ss.insertSheet(nombre);
    const cab = sh.getRange(1, 1, 1, COLUMNAS[nombre].length);
    if (sh.getLastRow() === 0 || cab.getValues()[0].join('|') !== COLUMNAS[nombre].join('|')) {
      // Hoja nueva, o columnas añadidas en una versión posterior: (re)escribir la cabecera.
      cab.setValues([COLUMNAS[nombre]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  // Quitar la pestaña vacía que trae una hoja nueva ("Hoja 1" / "Sheet1").
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function leer(ss, nombre) {
  const sh = ss.getSheetByName(nombre);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, COLUMNAS[nombre].length).getValues();
}

// Reescribe todos los datos de una pestaña de una vez (rápido incluso con miles de filas).
function escribir(ss, nombre, filas) {
  const sh = ss.getSheetByName(nombre);
  const ancho = COLUMNAS[nombre].length;
  const antes = sh.getLastRow() - 1;
  if (antes > 0) sh.getRange(2, 1, antes, ancho).clearContent();
  if (filas.length) sh.getRange(2, 1, filas.length, ancho).setValues(filas);
}

// Evita que un texto que empiece por = + - @ se interprete como fórmula.
function texto(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Sheets convierte "2026-11-13" en fecha; al leerla la devolvemos como texto.
function aFecha(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function lunes(fecha) {
  const p = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/* ---------- Sincronizar (upsert por id: nunca duplica) ---------- */
function sincronizar(ss, body) {
  const tz = ss.getSpreadsheetTimeZone();
  const borrados = body.borrados || [];
  const borrar = {};
  borrados.forEach(function (b) { borrar[b.id] = true; });

  // Ejercicios
  const ejercicios = body.ejercicios || [];
  const nombres = {};
  ejercicios.forEach(function (e) { nombres[e.id] = e.nombre; });
  if (ejercicios.length || borrados.length) {
    const filas = leer(ss, 'Ejercicios').filter(function (f) { return !borrar[f[0]]; });
    const idx = {};
    filas.forEach(function (f, i) { idx[f[0]] = i; });
    ejercicios.forEach(function (e) {
      const fila = [e.id, texto(e.nombre), texto(e.notas), e.archivado ? 'Sí' : 'No'];
      if (idx[e.id] !== undefined) filas[idx[e.id]] = fila; else { idx[e.id] = filas.length; filas.push(fila); }
    });
    escribir(ss, 'Ejercicios', filas);
  }

  // Rutinas: se reescriben enteras las rutinas recibidas
  const rutinas = body.rutinas || [];
  const nombresRutina = {}, nombresDia = {};
  if (rutinas.length) {
    const recibidas = {};
    rutinas.forEach(function (r) { recibidas[r.id] = true; });
    let filas = leer(ss, 'Rutinas').filter(function (f) { return !recibidas[f[0]]; });
    rutinas.forEach(function (r) {
      nombresRutina[r.id] = r.nombre;
      const estado = r.fin ? 'Archivada' : 'Activa';
      const base = [r.id, texto(r.nombre), r.inicio, r.fin || '', estado];
      if (!r.dias.length) filas.push(base.concat(['', '', '', '', '', '', '', '', '', '', '', '']));
      r.dias.forEach(function (d, di) {
        nombresDia[d.id] = d.nombre;
        const dia = [d.id, di + 1, texto(d.nombre), d.dia_semana === null || d.dia_semana === undefined ? '' : DIAS_SEMANA[d.dia_semana]];
        if (!d.ejercicios.length) filas.push(base.concat(dia, ['', '', '', '', '', '', '', '']));
        d.ejercicios.forEach(function (it, ii) {
          filas.push(base.concat(dia, [ii + 1, it.ejercicio_id, texto(it.ejercicio), it.series, it.reps_min, it.reps_max, it.incremento, texto(it.notas || '')]));
        });
      });
    });
    // Renombres de ejercicios también en Rutinas
    filas = filas.map(function (f) { if (f[10] && nombres[f[10]] !== undefined) f[11] = texto(nombres[f[10]]); return f; });
    escribir(ss, 'Rutinas', filas);
  } else if (ejercicios.length) {
    const filas = leer(ss, 'Rutinas');
    let cambio = false;
    filas.forEach(function (f) { if (f[10] && nombres[f[10]] !== undefined && f[11] !== nombres[f[10]]) { f[11] = texto(nombres[f[10]]); cambio = true; } });
    if (cambio) escribir(ss, 'Rutinas', filas);
  }

  // Registros
  const registros = body.registros || [];
  let filas = leer(ss, 'Registros').filter(function (f) { return !borrar[f[0]]; });
  const idx = {};
  filas.forEach(function (f, i) { idx[f[0]] = i; });
  registros.forEach(function (r) {
    const fila = [r.id, r.fecha, texto(r.rutina), texto(r.dia), r.ejercicio_id, texto(r.ejercicio), r.serie, r.peso, r.reps, texto(r.nota), r.id_sesion, r.id_rutina, r.id_dia];
    if (idx[r.id] !== undefined) filas[idx[r.id]] = fila; else { idx[r.id] = filas.length; filas.push(fila); }
  });
  // Renombres: el nombre se actualiza en todo el historial (el id no cambia)
  filas.forEach(function (f) {
    if (nombres[f[4]] !== undefined) f[5] = texto(nombres[f[4]]);
    if (nombresRutina[f[11]] !== undefined) f[2] = texto(nombresRutina[f[11]]);
    if (nombresDia[f[12]] !== undefined) f[3] = texto(nombresDia[f[12]]);
  });
  // Orden legible: por fecha y sesión, luego por serie
  filas.sort(function (a, b) {
    const fa = aFecha(a[1], tz), fb = aFecha(b[1], tz);
    if (fa !== fb) return fa < fb ? -1 : 1;
    if (a[10] !== b[10]) return a[10] < b[10] ? -1 : 1;
    if (a[5] !== b[5]) return String(a[5]) < String(b[5]) ? -1 : 1;
    return Number(a[6]) - Number(b[6]);
  });
  escribir(ss, 'Registros', filas);
  escribirProgreso(ss, filas, tz);
}

// Progreso: resumen por ejercicio y semana (peso máximo y volumen = peso × reps)
function escribirProgreso(ss, registros, tz) {
  const grupos = {};
  registros.forEach(function (f) {
    const fecha = aFecha(f[1], tz);
    if (!fecha) return;
    const clave = f[4] + '|' + lunes(fecha);
    const g = grupos[clave] || (grupos[clave] = { ejercicio: String(f[5]).replace(/^'/, ''), semana: lunes(fecha), max: 0, vol: 0, series: 0 });
    const peso = Number(f[7]) || 0, reps = Number(f[8]) || 0;
    g.max = Math.max(g.max, peso);
    g.vol += peso * reps;
    g.series += 1;
  });
  const filas = Object.keys(grupos).map(function (k) { return grupos[k]; })
    .sort(function (a, b) { return a.ejercicio.localeCompare(b.ejercicio, 'es') || (a.semana < b.semana ? -1 : a.semana > b.semana ? 1 : 0); })
    .map(function (g) { return [texto(g.ejercicio), g.semana, g.max, Math.round(g.vol * 100) / 100, g.series]; });
  escribir(ss, 'Progreso', filas);
}

/* ---------- Restaurar (la app reconstruye todo con esto) ---------- */
function restaurar(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const ejercicios = leer(ss, 'Ejercicios').filter(function (f) { return f[0]; }).map(function (f) {
    return { id: String(f[0]), nombre: String(f[1]), notas: String(f[2] || ''), archivado: f[3] === 'Sí' };
  });

  const rutinas = [], porId = {};
  leer(ss, 'Rutinas').forEach(function (f) {
    if (!f[0]) return;
    let r = porId[f[0]];
    if (!r) {
      r = porId[f[0]] = { id: String(f[0]), nombre: String(f[1]), inicio: aFecha(f[2], tz), fin: aFecha(f[3], tz), dias: [], _dias: {} };
      rutinas.push(r);
    }
    if (!f[5]) return;
    let d = r._dias[f[5]];
    if (!d) {
      const ds = DIAS_SEMANA.indexOf(String(f[8]));
      d = r._dias[f[5]] = { id: String(f[5]), orden: Number(f[6]), nombre: String(f[7]), dia_semana: ds >= 0 ? ds : null, ejercicios: [] };
      r.dias.push(d);
    }
    if (f[10]) {
      d.ejercicios.push({ orden: Number(f[9]), ejercicio_id: String(f[10]), ejercicio: String(f[11]), series: Number(f[12]), reps_min: Number(f[13]), reps_max: Number(f[14]), incremento: Number(f[15]), notas: String(f[16] || '') });
    }
  });
  rutinas.forEach(function (r) {
    delete r._dias;
    r.dias.sort(function (a, b) { return a.orden - b.orden; });
    r.dias.forEach(function (d) { d.ejercicios.sort(function (a, b) { return a.orden - b.orden; }); });
  });

  const registros = leer(ss, 'Registros').filter(function (f) { return f[0]; }).map(function (f) {
    return {
      id: String(f[0]), fecha: aFecha(f[1], tz), rutina: String(f[2]), dia: String(f[3]),
      ejercicio_id: String(f[4]), ejercicio: String(f[5]), serie: Number(f[6]), peso: Number(f[7]),
      reps: Number(f[8]), nota: String(f[9] || ''), id_sesion: String(f[10]), id_rutina: String(f[11]), id_dia: String(f[12]),
    };
  });
  return { ejercicios: ejercicios, rutinas: rutinas, registros: registros };
}
