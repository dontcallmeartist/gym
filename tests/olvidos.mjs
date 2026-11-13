import { chromium } from 'playwright-core';
const OUT = new URL('./capturas/', import.meta.url).pathname.slice(1);
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const MOCK = 'http://localhost:8090';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m, x); } };
const dump = async () => (await fetch(MOCK + '/__dump')).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(200); } return null; }

await fetch(MOCK + '/__reset');
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(300); };
const card = (name) => page.locator('section.card').filter({ has: page.getByRole('heading', { name, exact: true }) });

console.log('\nEntreno olvidado sin terminar');
await page.clock.setFixedTime(new Date('2026-11-16T19:00:00')); // lunes
await page.goto('http://localhost:8080/#ajustes'); await page.waitForSelector('#cfg-url');
await page.fill('#cfg-url', MOCK + '/exec'); await page.fill('#cfg-secret', 'clave-de-prueba');
await page.click('[data-act=cfg-test]'); await page.waitForTimeout(800);
await go('#entrenar');
for (const [n, r] of [[1, 10], [2, 9]]) {
  const row = card('Press banca').locator(`.set[data-n="${n}"]`);
  await row.locator('[data-f=w]').fill('60'); await row.locator('[data-f=r]').fill(String(r));
  await row.locator('[data-act=check]').click(); await page.waitForTimeout(250);
}
// Última serie: escrita pero SIN ✓, y la app se cierra
const r3 = card('Press banca').locator('.set[data-n="3"]');
await r3.locator('[data-f=w]').fill('60'); await r3.locator('[data-f=r]').fill('8'); await r3.locator('[data-f=r]').blur();
await page.waitForTimeout(400);
await page.close(); // "cerrar la app desde el multitarea"

const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(e.message)); p2.on('dialog', (d) => d.accept());
await p2.clock.setFixedTime(new Date('2026-11-17T10:00:00')); // al día siguiente
await p2.goto('http://localhost:8080/'); await p2.waitForSelector('h1');
const P = p2;
const card2 = (name) => P.locator('section.card').filter({ has: P.getByRole('heading', { name, exact: true }) });
ok(await P.locator('.card.stale').count() === 1 && (await P.textContent('.card.stale')).includes('16 nov'), 'al abrir al día siguiente: aviso "Entreno sin terminar del 16 nov"');
ok(await P.locator('.set.done').count() === 2, 'las 2 series marcadas siguen ahí');
ok((await card2('Press banca').locator('.set[data-n="3"] [data-f=r]').inputValue()) === '8', 'la serie escrita sin ✓ también se conserva (como borrador)');
await P.screenshot({ path: OUT + 't5-aviso.png' });
await P.evaluate(() => { location.hash = '#historial'; }); await P.waitForTimeout(300);
ok((await P.textContent('#banner')).includes('sin terminar'), 'en otras pestañas aparece el aviso arriba');
await P.screenshot({ path: OUT + 't5-banner.png' });
await P.evaluate(() => { location.hash = '#entrenar'; }); await P.waitForTimeout(300);
ok(await P.locator('#banner').isHidden(), 'en Entrenar no se repite el aviso de arriba');
await card2('Press banca').locator('.set[data-n="3"] [data-act=check]').click(); await P.waitForTimeout(300);
await P.click('.card.stale [data-act=finish]'); await P.waitForTimeout(500);
let d = await waitFor(async () => { const x = await dump(); return x.sheets.Registros.length === 4 ? x : null; });
ok(d && d.sheets.Registros.slice(1).every((r) => r[1] === '2026-11-16'), '«Terminar y enviar» → 3 series en Google con la fecha del entreno (16 nov)');

console.log('\nAñadir series a un entreno pasado');
const sid = await P.evaluate(async () => (await __gym.dbAll('sessions'))[0].id);
await P.evaluate((s) => { location.hash = '#historial/ses/' + s; }, sid); await P.waitForTimeout(300);
await card2('Press banca').locator('[data-act=past-add]').click(); await P.waitForTimeout(200);
const addRow = card2('Press banca').locator('.set[data-mode=add]');
ok(await addRow.count() === 1 && (await addRow.getAttribute('data-n')) === '4' && (await addRow.locator('[data-f=w]').inputValue()) === '60', '«+ Serie» abre la serie 4 con el peso de la anterior');
await addRow.locator('[data-f=r]').fill('7');
await P.screenshot({ path: OUT + 't5-anadir.png', fullPage: true });
await addRow.locator('[data-act=past-add-ok]').click(); await P.waitForTimeout(400);
d = await waitFor(async () => { const x = await dump(); return x.sheets.Registros.length === 5 ? x : null; });
ok(d && d.sheets.Registros.some((r) => r[6] === 4 && r[8] === 7 && r[1] === '2026-11-16'), 'la serie añadida llega a Google con la fecha del entreno');
await P.click('[data-act=past-add-ex]'); await P.waitForTimeout(200);
await P.locator('#picker-list [data-act=pick]', { hasText: /^Fondos$/ }).click(); await P.waitForTimeout(200);
const fRow = card2('Fondos').locator('.set[data-mode=add]');
await fRow.locator('[data-f=w]').fill('0'); await fRow.locator('[data-f=r]').fill('12');
await fRow.locator('[data-act=past-add-ok]').click(); await P.waitForTimeout(400);
d = await waitFor(async () => { const x = await dump(); return x.sheets.Registros.length === 6 ? x : null; });
ok(d && d.sheets.Registros.some((r) => r[5] === 'Fondos' && r[8] === 12), '«+ Añadir ejercicio» añade un ejercicio olvidado entero');
await card2('Press banca').locator('[data-act=past-add]').click(); await P.waitForTimeout(200);
await P.evaluate(() => { location.hash = '#historial'; }); await P.waitForTimeout(300);
await P.evaluate((s) => { location.hash = '#historial/ses/' + s; }, sid); await P.waitForTimeout(300);
ok(await P.locator('.set[data-mode=add]').count() === 0, 'una serie a medio añadir se descarta al salir (no se guarda nada)');
ok((await P.evaluate(async () => (await __gym.dbAll('sets')).length)) === 5, 'en el móvil hay exactamente 5 series');
console.log('\nErrores:', errs.length ? errs : 'ninguno');
console.log(`RESULTADO: ${pass} correctas, ${fail} fallidas`);
await b.close();
