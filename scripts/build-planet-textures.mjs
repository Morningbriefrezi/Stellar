// Rebuilds public/solar-system/planets from the Solar System Scope texture set
// on Wikimedia Commons (CC BY 4.0, INOVE — built from NASA mission maps).
//
// Each body ships two files:
//   <id>.jpg     2048x1024 — loaded on first paint
//   <id>-4k.jpg  4096x2048 — swapped in when the camera closes on the body
// so zooming in never lands on a blurred 720px map.
//
//   node scripts/build-planet-textures.mjs
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve('public/solar-system/planets');
const CACHE = path.resolve(process.env.TMPDIR ?? '/tmp', 'stellar-planet-src');
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';

/** file → [commons path, ships a 4K detail map] */
const SOURCES = {
  sun:            ['a/a4/Solarsystemscope_texture_8k_sun.jpg', true],
  mercury:        ['2/27/Solarsystemscope_texture_8k_mercury.jpg', true],
  venus:          ['5/57/Solarsystemscope_texture_4k_venus_atmosphere.jpg', true],
  earth:          ['0/04/Solarsystemscope_texture_8k_earth_daymap.jpg', true],
  'earth-night':  ['b/b3/Solarsystemscope_texture_8k_earth_nightmap.jpg', false],
  'earth-clouds': ['7/7a/Solarsystemscope_texture_8k_earth_clouds.jpg', false],
  moon:           ['d/d1/Solarsystemscope_texture_8k_moon.jpg', true],
  mars:           ['7/70/Solarsystemscope_texture_8k_mars.jpg', true],
  jupiter:        ['5/5e/Solarsystemscope_texture_8k_jupiter.jpg', true],
  saturn:         ['1/1e/Solarsystemscope_texture_8k_saturn.jpg', true],
  uranus:         ['9/95/Solarsystemscope_texture_2k_uranus.jpg', false],
  neptune:        ['1/1e/Solarsystemscope_texture_2k_neptune.jpg', false],
};

async function fetchSource(id, rel) {
  const cached = path.join(CACHE, `${id}.jpg`);
  try {
    if ((await stat(cached)).size > 40_000) return readFile(cached);
  } catch { /* not cached yet */ }
  // Commons throttles bursts with a 429; back off and retry rather than
  // dropping half the set on the floor.
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${COMMONS}/${rel}`, {
      headers: { 'User-Agent': 'stellar-texture-build/1.0 (stellarr.club)' },
    });
    if (res.ok) break;
    if (res.status !== 429 || attempt === 5) throw new Error(`${id}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(cached, buf);
  return buf;
}

// Equirectangular maps wrap in longitude, so the encoder must not be allowed
// to soften the seam; chromaSubsampling off keeps the band colours honest on
// the gas giants, where 4:2:0 visibly greys the red belts.
const encode = (img, w) =>
  img
    .clone()
    .resize(w, w / 2, { kernel: 'lanczos3', fit: 'fill' })
    .jpeg({ quality: w >= 4096 ? 84 : 88, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });

let total = 0;
for (const [id, [rel, wants4k]] of Object.entries(SOURCES)) {
  const src = sharp(await fetchSource(id, rel), { limitInputPixels: 512e6 });
  const { width } = await src.metadata();
  const base = await encode(src, 2048);
  await writeFile(path.join(OUT, `${id}.jpg`), base);
  let line = `${id.padEnd(14)} src ${String(width).padStart(5)}px  2k ${(base.length / 1e6).toFixed(2)}MB`;
  total += base.length;
  if (wants4k && width >= 4096) {
    const hi = await encode(src, 4096);
    await writeFile(path.join(OUT, `${id}-4k.jpg`), hi);
    line += `  4k ${(hi.length / 1e6).toFixed(2)}MB`;
    total += hi.length;
  }
  console.log(line);
}
console.log(`\ntotal ${(total / 1e6).toFixed(1)}MB`);
