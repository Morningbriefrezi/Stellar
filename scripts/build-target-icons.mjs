// Normalises the NASA/ESA target photos in public/sky/targets into a single
// uniform icon set: 256x256, every object scaled to the same apparent size and
// centred on the same near-black field, so the /sky rails render one row of
// equal discs instead of a dozen differently-framed crops.
//
//   node scripts/build-target-icons.mjs
//
// Sources stay in public/sky/targets/*.jpg; output lands in .../icons/*.png.

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'public/sky/targets');
const OUT = path.join(SRC, 'icons');
const CANVAS = 256;
const FIELD = { r: 5, g: 7, b: 14, alpha: 1 };

/** Bodies with a hard limb: auto-crop to the lit disc, then scale it to `fit`. */
const DISCS = {
  sun: 0.90,
  moon: 0.86,
  mercury: 0.86,
  venus: 0.86,
  mars: 0.86,
  jupiter: 0.86,
  saturn: 0.94, // widest extent is the rings, on the horizontal centre line
  uranus: 0.86,
  neptune: 0.86,
};

/** Deep-sky fields: no limb to detect, so centre-crop a square of `crop` px. */
const FIELDS = {
  m31: { crop: 285 },
  m42: { crop: 540 },
  m57: { crop: 660 },
};

/** Stars are point sources — no photo exists, so draw the airy disc we mean. */
const STARS = {
  sirius: { core: '#FFFFFF', halo: '#BFD6FF', spike: 'rgba(214,231,255,0.85)', r: 13 },
  arcturus: { core: '#FFF3E0', halo: '#FFC078', spike: 'rgba(255,196,124,0.8)', r: 12 },
};

/** Tight bounding box of everything brighter than `threshold`, ignoring specks. */
async function discBounds(file, threshold = 26, minRun = 3) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const cols = new Int32Array(width);
  const rows = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > threshold) { cols[x]++; rows[y]++; }
    }
  }
  const span = (counts) => {
    let lo = 0;
    let hi = counts.length - 1;
    while (lo < counts.length && counts[lo] < minRun) lo++;
    while (hi > lo && counts[hi] < minRun) hi--;
    return [lo, hi];
  };
  const [x0, x1] = span(cols);
  const [y0, y1] = span(rows);
  return { left: x0, top: y0, width: Math.max(1, x1 - x0 + 1), height: Math.max(1, y1 - y0 + 1) };
}

function canvas() {
  return sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: FIELD } });
}

async function buildDisc(id, fit) {
  const file = path.join(SRC, `${id}.jpg`);
  const box = await discBounds(file);
  const scale = (CANVAS * fit) / Math.max(box.width, box.height);
  const w = Math.max(1, Math.round(box.width * scale));
  const h = Math.max(1, Math.round(box.height * scale));
  const body = await sharp(file).extract(box).resize(w, h, { fit: 'fill' }).png().toBuffer();
  await canvas()
    .composite([{ input: body, left: Math.round((CANVAS - w) / 2), top: Math.round((CANVAS - h) / 2) }])
    .png()
    .toFile(path.join(OUT, `${id}.png`));
  return `${id}  disc ${box.width}x${box.height} -> ${w}x${h}`;
}

async function buildField(id, { crop }) {
  const file = path.join(SRC, `${id}.jpg`);
  const { width, height } = await sharp(file).metadata();
  const side = Math.min(crop, width, height);
  const body = await sharp(file)
    .extract({
      left: Math.round((width - side) / 2),
      top: Math.round((height - side) / 2),
      width: side,
      height: side,
    })
    .resize(CANVAS, CANVAS)
    .png()
    .toBuffer();
  await canvas().composite([{ input: body, left: 0, top: 0 }]).png().toFile(path.join(OUT, `${id}.png`));
  return `${id}  field ${side}px -> ${CANVAS}`;
}

async function buildStar(id, { core, halo, spike, r }) {
  const c = CANVAS / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
    <defs>
      <radialGradient id="h" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${core}" stop-opacity="1"/>
        <stop offset="18%" stop-color="${halo}" stop-opacity="0.55"/>
        <stop offset="46%" stop-color="${halo}" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="${halo}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="sx" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${spike}" stop-opacity="0"/>
        <stop offset="50%" stop-color="${spike}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${spike}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="sy" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${spike}" stop-opacity="0"/>
        <stop offset="50%" stop-color="${spike}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${spike}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <circle cx="${c}" cy="${c}" r="${c}" fill="url(#h)"/>
    <rect x="14" y="${c - 1.1}" width="${CANVAS - 28}" height="2.2" fill="url(#sx)"/>
    <rect x="${c - 1.1}" y="14" width="2.2" height="${CANVAS - 28}" fill="url(#sy)"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="${core}"/>
  </svg>`;
  await canvas()
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toFile(path.join(OUT, `${id}.png`));
  return `${id}  star`;
}

await mkdir(OUT, { recursive: true });
for (const [id, fit] of Object.entries(DISCS)) console.log(await buildDisc(id, fit));
for (const [id, spec] of Object.entries(FIELDS)) console.log(await buildField(id, spec));
for (const [id, spec] of Object.entries(STARS)) console.log(await buildStar(id, spec));
