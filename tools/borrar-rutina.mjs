// Borra por completo una rutina de la hoja de Google (no toca los registros de entrenos).
// Uso: node tools/borrar-rutina.mjs "<nombre de la rutina>" [--probar]
// Después, en el iPhone: Ajustes → Restaurar desde Google.
import { readFileSync } from 'node:fs';

// Todo dentro de main() para terminar limpiamente (sin process.exit tras usar fetch).
async function main() {
const [nombre, flag] = process.argv.slice(2);
if (!nombre) { console.error('Uso: node tools/borrar-rutina.mjs "<nombre>" [--probar]'); { process.exitCode = 1; return; } }
const conf = process.env.GYM_URL ? [] : readFileSync(new URL('../.private/conexion.txt', import.meta.url), 'utf8').split(/\r?\n/);
const after = (label) => conf[conf.findIndex((l) => l.includes(label)) + 1].trim();
const URL_SCRIPT = process.env.GYM_URL || after('URL del script');
const KEY = process.env.GYM_KEY || after('Clave secreta');
async function call(body) {
  const r = await fetch(URL_SCRIPT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, secret: KEY }) });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error);
  return data;
}

const actual = await call({ action: 'restore' });
const rutinas = actual.rutinas.filter((r) => r.nombre === nombre);
if (rutinas.length !== 1) { console.error(`Se esperaba 1 rutina llamada «${nombre}» y hay ${rutinas.length}.`); { process.exitCode = 1; return; } }
const r = rutinas[0];
if (!r.fin) { console.error('Es la rutina activa: no se borra.'); { process.exitCode = 1; return; } }
const sesiones = actual.registros.filter((x) => x.id_rutina === r.id).length;
console.log(`Rutina «${r.nombre}» (${r.inicio} – ${r.fin}), ${r.dias.length} días, ${sesiones} series registradas con ella.`);
if (sesiones) { console.error('Tiene entrenos registrados: no se borra (perderían su rutina).'); { process.exitCode = 1; return; } }
if (flag === '--probar') { console.log('(--probar: no se ha borrado nada)'); { process.exitCode = 0; return; } }
await call({ action: 'sync', sesiones: [], registros: [], ejercicios: [], rutinas: [], borrados: [{ id: r.id, kind: 'routine' }] });
const check = await call({ action: 'restore' });
console.log(check.rutinas.some((x) => x.id === r.id) ? '✘ Sigue en la hoja.' : '✓ Rutina borrada de la hoja. En el iPhone: Ajustes → Restaurar desde Google.');
}
await main();
