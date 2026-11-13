import { chromium } from 'playwright-core';
const OUT = new URL('./capturas/', import.meta.url).pathname.slice(1);
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8080/');
await page.waitForSelector('h1');
await page.evaluate(() => navigator.serviceWorker.ready);
console.log('H1 entrenar:', await page.textContent('h1'));
console.log('ejercicios cards:', await page.locator('section.card').count());
const ex = await page.evaluate(async () => (await __gym.dbAll('exercises')).length);
const rt = await page.evaluate(async () => (await __gym.dbAll('routines')).map(r => r.name));
console.log('seed:', ex, 'ejercicios;', rt);
await page.screenshot({ path: OUT + '1-entrenar.png', fullPage: true });
for (const tab of ['historial', 'rutinas', 'ajustes']) {
  await page.click(`.tabs a[data-tab=${tab}]`);
  await page.waitForTimeout(200);
  console.log(tab, '→', await page.textContent('h1'));
  await page.screenshot({ path: OUT + `1-${tab}.png`, fullPage: true });
}
// Sin conexión: recargar
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('h1');
console.log('offline reload h1:', await page.textContent('h1'));
await ctx.setOffline(false);
// Persistencia: recargar y comprobar que no se duplica la semilla
await page.reload(); await page.waitForSelector('h1');
console.log('tras recargar, ejercicios:', await page.evaluate(async () => (await __gym.dbAll('exercises')).length));
// Modo oscuro
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto('http://localhost:8080/#entrenar'); await page.waitForSelector('h1');
await page.screenshot({ path: OUT + '1-entrenar-dark.png', fullPage: false });
const man = await (await page.request.get('http://localhost:8080/manifest.json')).json();
console.log('manifest display:', man.display, 'icons:', man.icons.length);
console.log('ERRORES:', errors.length ? errors : 'ninguno');
await browser.close();
