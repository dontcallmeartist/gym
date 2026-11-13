// Genera los iconos PNG de la app (sin dependencias). Uso: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [255, 90, 31];   // naranja
const FG = [255, 255, 255]; // blanco

// Formas en coordenadas 0..100: [x0, y0, x1, y1, radio]
const SHAPES = [
  [22, 47, 78, 53, 1.5],   // barra
  [29, 31, 36, 69, 2.5],   // disco interior izq.
  [64, 31, 71, 69, 2.5],   // disco interior der.
  [21, 38, 28, 62, 2.5],   // disco exterior izq.
  [72, 38, 79, 62, 2.5],   // disco exterior der.
];

function inRoundRect(x, y, [x0, y0, x1, y1, r]) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, scale = 1) {
  const SS = 4; // supermuestreo para bordes suaves
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        // escala alrededor del centro (para el icono "maskable", más pequeño)
        const x = 50 + (((px + (sx + 0.5) / SS) / size) * 100 - 50) / scale;
        const y = 50 + (((py + (sy + 0.5) / SS) / size) * 100 - 50) / scale;
        if (SHAPES.some(s => inRoundRect(x, y, s))) hits++;
      }
      const a = hits / (SS * SS);
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('apple-touch-icon.png', out), png(180));
writeFileSync(new URL('icon-192.png', out), png(192));
writeFileSync(new URL('icon-512.png', out), png(512));
writeFileSync(new URL('icon-maskable-512.png', out), png(512, 0.8));
console.log('Iconos generados en icons/');
