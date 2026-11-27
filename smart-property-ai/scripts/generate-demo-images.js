// Generates 3 synthetic, geo-referenced "satellite" images of the same area
// (Jan / Jun / Nov) to demo change detection & construction monitoring offline.
//   t0: farmland + existing house
//   t1: land cleared (earthwork) inside the parcel, trees cut
//   t2: new building inside parcel + a shed that crosses the parcel boundary (encroachment)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

export const DEMO_EXTENT = { minLon: 77.5900, minLat: 12.9700, maxLon: 77.5915, maxLat: 12.9715 };
export const DEMO_SIZE = 512;
// parcel (survey no. 123/4) in pixel coordinates -> converted to lon/lat in seed.js
export const DEMO_PARCEL_PX = [[150, 140], [370, 140], [370, 360], [150, 360]];

const OUT = path.resolve('data/demo');

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function makeCanvas(seed) {
  const W = DEMO_SIZE, H = DEMO_SIZE;
  const buf = Buffer.alloc(W * H * 3);
  const rand = rng(seed);
  // base: crop field (green with texture)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const n = (rand() - 0.5) * 18 + Math.sin(x / 9) * 6;
    buf[i] = 70 + n; buf[i + 1] = 130 + n; buf[i + 2] = 55 + n;
  }
  const rect = (x0, y0, x1, y1, [r, g, b], noise = 6) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 3, n = (rand() - 0.5) * noise;
      buf[i] = r + n; buf[i + 1] = g + n; buf[i + 2] = b + n;
    }
  };
  const circle = (cx, cy, rad, col) => {
    for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) rect(x, y, x + 1, y + 1, col, 10);
    }
  };
  return { buf, rect, circle, W, H };
}

async function save(c, name) {
  await sharp(c.buf, { raw: { width: c.W, height: c.H, channels: 3 } }).png().toFile(path.join(OUT, name));
  console.log('✔ data/demo/' + name);
}

function commonScene(c) {
  c.rect(0, 430, 512, 452, [120, 120, 118]);          // road
  c.rect(40, 40, 110, 100, [200, 200, 195]);          // existing house (neighbour, unchanged)
  c.rect(420, 60, 490, 120, [180, 70, 50]);           // tiled roof house (neighbour)
  c.rect(0, 0, 512, 6, [40, 80, 150]);                // canal strip
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // t0 — January: farmland, trees inside parcel
  let c = makeCanvas(1);
  commonScene(c);
  for (const [x, y] of [[200, 200], [240, 300], [320, 180], [300, 320]]) c.circle(x, y, 14, [30, 95, 35]);
  await save(c, 'scene_2026-01-15.png');

  // t1 — June: parcel cleared (bare soil), trees removed -> earthwork / vegetation loss
  c = makeCanvas(2);
  commonScene(c);
  c.rect(170, 160, 350, 340, [150, 115, 80], 14);     // excavated soil
  c.rect(200, 190, 300, 270, [165, 160, 150], 8);     // foundation slab (partially built)
  await save(c, 'scene_2026-06-10.png');

  // t2 — November: building complete + shed crossing the east boundary (encroachment)
  c = makeCanvas(3);
  commonScene(c);
  c.rect(170, 160, 350, 340, [150, 115, 80], 14);
  c.rect(190, 180, 320, 300, [215, 215, 210], 6);     // new concrete building
  c.rect(345, 230, 410, 280, [205, 205, 200], 6);     // shed crossing boundary at x=370
  c.rect(60, 300, 120, 360, [150, 115, 80], 14);      // neighbouring land cleared (outside parcel)
  await save(c, 'scene_2026-11-20.png');

  fs.writeFileSync(path.join(OUT, 'extent.json'), JSON.stringify({ ...DEMO_EXTENT, width: DEMO_SIZE, height: DEMO_SIZE }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { main as generateDemoImages };
