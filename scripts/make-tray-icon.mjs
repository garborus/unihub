// Gera o ícone do UnusHub: um "U" branco sobre um quadrado azul arredondado.
// Desenho próprio do UnusHub, sem imagens de terceiros. O desenho é feito numa
// grade de 32 e ampliado para o tamanho pedido.
// Uso: node scripts/make-tray-icon.mjs                       (bandeja, 32 px)
//      node scripts/make-tray-icon.mjs 256 build/icon.png     (ícone do .exe)

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = Number(process.argv[2]) || 32;
const OUT = process.argv[3] || 'src/main/assets/tray.png';
const GRID = 32; // o desenho abaixo está nesta grade
const SAMPLES = 4; // amostras por pixel, para suavizar as bordas
const BLUE = [76, 141, 255];
const WHITE = [255, 255, 255];

function inRoundedSquare(x, y) {
  const r = 7;
  const cx = Math.min(Math.max(x, r), GRID - r);
  const cy = Math.min(Math.max(y, r), GRID - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// "U": duas hastes e um arco embaixo.
function inU(x, y) {
  const left = x >= 9 && x <= 13.5;
  const right = x >= 18.5 && x <= 23;
  if (y >= 7 && y <= 17) return left || right;
  if (y > 17 && y <= 26) {
    const d = Math.hypot(x - 16, y - 17);
    return d >= 2.5 && d <= 7;
  }
  return false;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let bg = 0;
    let fg = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = ((px + (sx + 0.5) / SAMPLES) * GRID) / SIZE;
        const y = ((py + (sy + 0.5) / SAMPLES) * GRID) / SIZE;
        if (!inRoundedSquare(x, y)) continue;
        bg++;
        if (inU(x, y)) fg++;
      }
    }
    const n = SAMPLES * SAMPLES;
    const t = bg ? fg / bg : 0;
    const i = (py * SIZE + px) * 4;
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(BLUE[c] * (1 - t) + WHITE[c] * t);
    pixels[i + 3] = Math.round((bg / n) * 255);
  }
}

// PNG mínimo: cabeçalho, IHDR, IDAT (linhas com filtro 0) e IEND.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bits por canal
ihdr[9] = 6; // RGBA
const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) pixels.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = new URL(`../${OUT}`, import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, png);
console.log(`ícone gerado: ${out.pathname} (${png.length} bytes)`);
