// Carga una rutina (archivo JSON) en la hoja de Google, sin pasar por la app.
// Después, en el iPhone: Ajustes → (Todo sincronizado) → Restaurar desde Google.
//
// Uso: node tools/cargar-rutina.mjs <rutina.json> [--probar]
//   --probar  solo muestra lo que haría, sin escribir nada.
//
// - Los ejercicios se buscan por nombre (sin distinguir mayúsculas ni acentos):
//   si ya existen se reutilizan (conservan historial y progresión); si no, se crean.
// - La rutina activa anterior queda archivada con fecha de fin = hoy.
// - Los ejercicios sin ningún registro que no use la rutina nueva se archivan
//   (no se borran; se pueden recuperar desde el catálogo de la app).
// La URL y la clave se leen de .private/conexion.txt (nunca van al repositorio).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('Uso: node tools/cargar-rutina.mjs <rutina.json> [--probar]'); process.exit(1); }
const dryRun = flag === '--probar';
// Para pruebas con el simulador: GYM_URL y GYM_KEY sustituyen a conexion.txt.
const conf = process.env.GYM_URL ? [] : readFileSync(new URL('../.private/conexion.txt', import.meta.url), 'utf8').split(/\r?\n/);
const after = (label) => conf[conf.findIndex((l) => l.includes(label)) + 1].trim();
const URL_SCRIPT = process.env.GYM_URL || after('URL del script');
const KEY = process.env.GYM_KEY || after('Clave secreta');

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const hoy = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

async function call(body) {
  const r = await fetch(URL_SCRIPT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, secret: KEY }) });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error);
  return data;
}

const rutina = JSON.parse(readFileSync(file, 'utf8'));
const actual = await call({ action: 'restore' });
const porNombre = new Map(actual.ejercicios.map((e) => [norm(e.nombre), e]));
const usados = new Set(actual.registros.map((r) => r.ejercicio_id));
const ejercicios = [];      // ejercicios a crear/actualizar
const idsRutina = new Set();

const nueva = {
  id: randomUUID(), nombre: rutina.nombre, inicio: rutina.inicio || hoy, fin: '',
  dias: rutina.dias.map((dia) => ({
    id: randomUUID(), nombre: dia.nombre,
    dia_semana: dia.dia_semana ? DIAS.indexOf(norm(dia.dia_semana)) : null,
    ejercicios: dia.ejercicios.map((it) => {
      let ex = porNombre.get(norm(it.ejercicio));
      if (!ex) {
        ex = { id: randomUUID(), nombre: it.ejercicio, notas: '', archivado: false, nuevo: true };
        porNombre.set(norm(it.ejercicio), ex);
        ejercicios.push(ex);
      } else if (ex.archivado) { ex.archivado = false; ejercicios.push(ex); }
      idsRutina.add(ex.id);
      const [min, max] = String(it.reps).split(/[-–]/).map((n) => Number(n.trim()));
      return {
        ejercicio_id: ex.id, ejercicio: ex.nombre, series: it.series, reps_min: min, reps_max: max || min,
        incremento: it.incremento ?? 2.5, notas: it.notas || '',
      };
    }),
  })),
};

// Archivar la rutina activa anterior
const archivadas = actual.rutinas.filter((r) => !r.fin).map((r) => ({ ...r, fin: hoy }));
// Archivar ejercicios sin registros que la rutina nueva no usa
for (const e of actual.ejercicios) {
  if (!e.archivado && !usados.has(e.id) && !idsRutina.has(e.id)) ejercicios.push({ ...e, archivado: true });
}

console.log(`Rutina nueva: «${nueva.nombre}» (${nueva.dias.length} días)`);
nueva.dias.forEach((dd) => console.log(`  ${dd.nombre}: ${dd.ejercicios.map((i) => `${i.ejercicio} ${i.series}×${i.reps_min === i.reps_max ? i.reps_min : i.reps_min + '–' + i.reps_max}`).join(' · ')}`));
console.log(`Ejercicios reutilizados (conservan historial): ${[...idsRutina].filter((id) => !ejercicios.some((e) => e.id === id && e.nuevo)).length}`);
console.log(`Ejercicios nuevos: ${ejercicios.filter((e) => e.nuevo).length}`);
console.log(`Rutinas que se archivan: ${archivadas.map((r) => r.nombre).join(', ') || 'ninguna'}`);
console.log(`Ejercicios sin uso que se archivan: ${ejercicios.filter((e) => e.archivado).map((e) => e.nombre).join(', ') || 'ninguno'}`);
if (dryRun) { console.log('\n(--probar: no se ha escrito nada)'); process.exit(0); }

await call({
  action: 'sync', sesiones: [], registros: [], borrados: [],
  ejercicios: ejercicios.map(({ id, nombre, notas, archivado }) => ({ id, nombre, notas, archivado })),
  rutinas: [...archivadas, nueva],
});
const check = await call({ action: 'restore' });
const ok = check.rutinas.some((r) => r.id === nueva.id && !r.fin && r.dias.length === nueva.dias.length);
console.log(ok ? '\n✓ Rutina cargada en la hoja. En el iPhone: Ajustes → Restaurar desde Google.' : '\n✘ Algo no cuadra: revisa la hoja.');
