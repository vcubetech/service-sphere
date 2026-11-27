import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectChanges } from '../src/services/changeDetection.js';
import { pixelToLonLat, rasterizePolygon } from '../src/utils/geo.js';
import { generateDemoImages, DEMO_EXTENT, DEMO_SIZE, DEMO_PARCEL_PX } from '../scripts/generate-demo-images.js';

const meta = (f) => ({ filePath: path.resolve('data/demo', f), width: DEMO_SIZE, height: DEMO_SIZE, ...DEMO_EXTENT });
const ring = [...DEMO_PARCEL_PX, DEMO_PARCEL_PX[0]].map(([x, y]) => pixelToLonLat(x, y, { ...DEMO_EXTENT, width: DEMO_SIZE, height: DEMO_SIZE }));

test('generate demo images', async () => {
  await generateDemoImages();
  assert.ok(fs.existsSync('data/demo/scene_2026-11-20.png'));
});

test('rasterizePolygon fills a square', () => {
  const m = rasterizePolygon([[2, 2], [8, 2], [8, 8], [2, 8]], 10, 10);
  assert.equal(m.reduce((a, b) => a + b, 0), 36);
});

test('no change between identical images', async () => {
  const r = await detectChanges({ before: meta('scene_2026-01-15.png'), after: meta('scene_2026-01-15.png'), parcelRing: ring });
  assert.equal(r.regions.length, 0);
  assert.equal(r.stats.changedPercent, 0);
});

test('detects new construction + encroachment Jan -> Nov', async () => {
  const r = await detectChanges({
    before: meta('scene_2026-01-15.png'),
    after: meta('scene_2026-11-20.png'),
    parcelRing: ring,
    overlayPath: 'data/demo/overlay_test.png',
  });
  console.log(JSON.stringify(r.stats, null, 2));
  console.log(r.regions.map((x) => `${x.type} ${x.areaSqm}m² conf=${x.confidence} inside=${x.insideFraction} ${x.transition}`).join('\n'));
  assert.ok(r.stats.builtUpAfter > r.stats.builtUpBefore + 15, 'built-up should rise');
  assert.ok(r.regions.some((x) => x.type === 'NEW_CONSTRUCTION' && x.insideBoundary));
  assert.ok(r.regions.some((x) => x.crossesBoundary), 'shed crossing boundary should be flagged');
  assert.ok(r.regions.some((x) => !x.insideBoundary && x.insideFraction === 0), 'outside-parcel change detected');
  assert.ok(fs.existsSync('data/demo/overlay_test.png'));
});
