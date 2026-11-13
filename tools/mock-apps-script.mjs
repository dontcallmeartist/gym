// Simulador de Google Apps Script para probar la sincronización sin una cuenta de Google.
// Ejecuta el Code.gs REAL con una hoja de cálculo falsa en memoria e imita a Google:
//  - el POST responde con una redirección 302 a otra URL que devuelve el JSON;
//  - no contesta a la petición previa OPTIONS (como Apps Script), así que si la app
//    hiciera una petición "no simple", el navegador la bloquearía igual que en la realidad.
// Uso: node tools/mock-apps-script.mjs [puerto] [clave]   → URL: http://localhost:8090/exec
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// El servidor de Google ejecuta el script con una zona horaria propia (en la prueba real: UTC+9).
process.env.TZ = 'Asia/Tokyo';
const PORT = Number(process.argv[2]) || 8090;
const KEY = process.argv[3] || 'clave-de-prueba';
// Igual que la hoja real: la hoja con hora de Los Ángeles y el script con la de Madrid.
const SHEET_TZ = 'America/Los_Angeles';
const SCRIPT_TZ = 'Europe/Madrid';

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      out.push(Array.from({ length: this.nc }, (_, j) => { const v = row[this.c - 1 + j]; return v === undefined ? '' : v; }));
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error('Las dimensiones no coinciden');
    vals.forEach((row, i) => {
      const target = (this.sheet.data[this.r - 1 + i] = this.sheet.data[this.r - 1 + i] || []);
      row.forEach((v, j) => { target[this.c - 1 + j] = convert(v); });
    });
    return this;
  }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const row = this.sheet.data[this.r - 1 + i]; if (row) row[this.c - 1 + j] = ''; } return this; }
  setFontWeight() { return this; }
}
// Imita a Sheets: "2026-11-13" se convierte en fecha y el apóstrofo inicial fuerza texto.
function convert(v) {
  if (typeof v === 'string') {
    if (v.startsWith("'")) return v.slice(1);
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    // Como Sheets (comprobado en la hoja real): el texto se convierte en fecha a medianoche UTC.
    if (m) return new SheetDate(SheetDate.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  return v;
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1; return 0; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  setFrozenRows() {}
}
function newSpreadsheet() {
  const sheets = [new Sheet('Hoja 1')];
  return {
    sheets,
    getName: () => 'Gym (hoja simulada)',
    getSpreadsheetTimeZone: () => SHEET_TZ,
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  };
}

let ss = newSpreadsheet();
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  Session: { getScriptTimeZone: () => SCRIPT_TZ },
  Utilities: { formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) },
  console,
};
vm.createContext(ctx);
// Las fechas deben crearse con el Date del propio script (para que funcione "instanceof Date").
const SheetDate = vm.runInContext('Date', ctx);
const src = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8')
  .replace("const CLAVE_SECRETA = 'CAMBIA_ESTA_CLAVE';", `const CLAVE_SECRETA = ${JSON.stringify(KEY)};`);
vm.runInContext(src, ctx, { filename: 'Code.gs' });

const pending = new Map();
let counter = 0, requests = 0, preflights = 0;
const dump = () => Object.fromEntries(ss.sheets.map((s) => [s.name, s.data.slice(0, s.getLastRow()).map((r) => r.map((v) => (v instanceof SheetDate ? ctx.Utilities.formatDate(v, 'UTC') : v)))]));

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { preflights++; res.writeHead(405).end(); return; }
  if (req.method === 'POST' && url.pathname === '/exec') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests++;
      const out = ctx.doPost({ postData: { contents: body, type: req.headers['content-type'] } });
      const id = String(++counter);
      pending.set(id, out.s);
      res.writeHead(302, { Location: `http://localhost:${PORT}/echo?id=${id}`, 'Access-Control-Allow-Origin': '*' }).end();
    });
    return;
  }
  if (url.pathname === '/echo') {
    const s = pending.get(url.searchParams.get('id'));
    pending.delete(url.searchParams.get('id'));
    res.writeHead(s ? 200 : 404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(s || '');
    return;
  }
  // Rutas solo para las pruebas
  if (url.pathname === '/__dump') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ requests, preflights, sheets: dump() })); return; }
  if (url.pathname === '/__reset') { ss = newSpreadsheet(); requests = 0; preflights = 0; res.writeHead(200).end('ok'); return; }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`Apps Script simulado en http://localhost:${PORT}/exec (clave: ${KEY})`));
