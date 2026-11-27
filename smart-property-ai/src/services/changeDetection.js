/**
 * Satellite / aerial image change-detection engine.
 *
 * Pipeline
 *  1. Load the BEFORE and AFTER images, crop both to their common geographic extent,
 *     resample to the same analysis grid.
 *  2. Radiometric normalisation (per-channel mean/std matching) so seasonal / sun-angle
 *     differences are not reported as change.
 *  3. Per-pixel land-cover classification (vegetation / built-up / bare soil / water)
 *     using RGB spectral indices (ExG, brightness, saturation, blue dominance).
 *  4. Change magnitude = colour distance between normalised images -> blur -> threshold
 *     -> morphological open/close -> connected components = change regions.
 *  5. Each region is labelled by its dominant land-cover transition
 *     (e.g. VEGETATION -> BUILT = NEW_CONSTRUCTION) with a confidence score.
 *  6. Regions are geo-referenced and tested against the survey-parcel boundary, and
 *     parcel-level statistics (built-up %, vegetation %, changed %) are computed.
 *  7. An overlay PNG (after image + coloured change boxes + parcel outline) is produced.
 *
 * The classifier is intentionally dependency-free (sharp only). It can be swapped for a
 * deep-learning segmentation model (e.g. Siamese U-Net served over HTTP) by replacing
 * `classifyPixels` / `changeMagnitude` — the rest of the system only consumes the
 * returned `regions` + `stats` contract.
 */
import sharp from 'sharp';
import { pixelAreaSqm, pixelBoxToPolygon, lonLatToPixel, rasterizePolygon } from '../utils/geo.js';

export const LandCover = Object.freeze({ SOIL: 0, VEG: 1, BUILT: 2, WATER: 3 });
const LC_NAMES = ['SOIL', 'VEGETATION', 'BUILT', 'WATER'];

export const TYPE_COLORS = {
  NEW_CONSTRUCTION: [255, 40, 40],
  DEMOLITION: [255, 140, 0],
  VEGETATION_LOSS: [255, 230, 0],
  VEGETATION_GAIN: [0, 220, 90],
  EARTHWORK: [190, 120, 60],
  WATER_CHANGE: [0, 160, 255],
  UNKNOWN: [220, 0, 220],
};

// ---------------------------------------------------------------- image I/O

/** Intersection of two geographic extents, or null. */
export function intersectExtent(a, b) {
  const e = {
    minLon: Math.max(a.minLon, b.minLon),
    minLat: Math.max(a.minLat, b.minLat),
    maxLon: Math.min(a.maxLon, b.maxLon),
    maxLat: Math.min(a.maxLat, b.maxLat),
  };
  return e.minLon < e.maxLon && e.minLat < e.maxLat ? e : null;
}

/** Load image, crop to `extent`, resize to w×h, return raw RGB Uint8Array. */
async function loadCropped(filePath, meta, extent, w, h) {
  const left = Math.round(((extent.minLon - meta.minLon) / (meta.maxLon - meta.minLon)) * meta.width);
  const top = Math.round(((meta.maxLat - extent.maxLat) / (meta.maxLat - meta.minLat)) * meta.height);
  const right = Math.round(((extent.maxLon - meta.minLon) / (meta.maxLon - meta.minLon)) * meta.width);
  const bottom = Math.round(((meta.maxLat - extent.minLat) / (meta.maxLat - meta.minLat)) * meta.height);

  const { data } = await sharp(filePath)
    .removeAlpha()
    .extract({
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.max(1, Math.min(meta.width, right) - Math.max(0, left)),
      height: Math.max(1, Math.min(meta.height, bottom) - Math.max(0, top)),
    })
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

// ---------------------------------------------------------------- pixel maths

/**
 * Match per-channel mean/std of `src` to `ref` (both RGB), using only
 * pseudo-invariant pixels (lowest 50% raw difference) so real changes do not bias
 * the correction. Returns new Float32Array.
 */
export function normalizeRadiometry(src, ref) {
  const n = src.length / 3;
  const d = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    d[p] = Math.abs(src[i] - ref[i]) + Math.abs(src[i + 1] - ref[i + 1]) + Math.abs(src[i + 2] - ref[i + 2]);
  }
  const cutoff = Float32Array.from(d).sort()[Math.floor(n * 0.5)];
  const out = new Float32Array(src.length);
  for (let c = 0; c < 3; c++) {
    let ms = 0, mr = 0, k = 0;
    for (let p = 0; p < n; p++) if (d[p] <= cutoff) { ms += src[p * 3 + c]; mr += ref[p * 3 + c]; k++; }
    ms /= k; mr /= k;
    let vs = 0, vr = 0;
    for (let p = 0; p < n; p++) if (d[p] <= cutoff) { vs += (src[p * 3 + c] - ms) ** 2; vr += (ref[p * 3 + c] - mr) ** 2; }
    const ss = Math.sqrt(vs / k) || 1;
    const sr = Math.sqrt(vr / k) || 1;
    const gain = Math.min(1.5, Math.max(0.67, sr / ss)); // clamp to avoid over-stretching
    for (let p = 0; p < n; p++) {
      const i = p * 3 + c;
      out[i] = Math.min(255, Math.max(0, (src[i] - ms) * gain + mr));
    }
  }
  return out;
}

/** Classify every pixel into a LandCover class using RGB indices. */
export function classifyPixels(rgb, w, h) {
  const cls = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 3) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const sum = r + g + b + 1e-6;
    const exg = (2 * g - r - b) / sum;                    // Excess-Green index
    const bright = sum / 3;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;

    if (b > r + 15 && b > g - 5 && bright < 150) cls[p] = LandCover.WATER;
    else if (exg > 0.08 && g > 60) cls[p] = LandCover.VEG;
    else if ((bright > 140 && sat < 0.22) || (r > g + 35 && r > b + 35 && bright > 90)) cls[p] = LandCover.BUILT; // concrete / metal / tiled roofs
    else cls[p] = LandCover.SOIL;
  }
  return cls;
}

/** Colour distance between two RGB buffers -> Float32 per pixel. */
export function changeMagnitude(a, b, w, h) {
  const mag = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 3) {
    const dr = a[i] - b[i], dg = a[i + 1] - b[i + 1], db = a[i + 2] - b[i + 2];
    mag[p] = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
  }
  return boxBlur(mag, w, h, 1);
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}

function morph(mask, w, h, r, erode) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = erode ? 1 : 0;
    for (let dy = -r; dy <= r && (erode ? v : !v); dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      const m = xx >= 0 && xx < w && yy >= 0 && yy < h ? mask[yy * w + xx] : 0;
      if (erode && !m) { v = 0; break; }
      if (!erode && m) { v = 1; break; }
    }
    out[y * w + x] = v;
  }
  return out;
}
const open = (m, w, h, r) => morph(morph(m, w, h, r, true), w, h, r, false);
const close = (m, w, h, r) => morph(morph(m, w, h, r, false), w, h, r, true);

/** 8-connected component labelling. Returns { labels, components[] }. */
export function connectedComponents(mask, w, h, minArea) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    let sp = 0; stack[sp++] = s; labels[s] = next;
    const pixels = [];
    let minX = w, minY = h, maxX = 0, maxY = 0;
    while (sp) {
      const p = stack[--sp]; pixels.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (mask[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; }
      }
    }
    if (pixels.length >= minArea) {
      comps.push({ label: next, pixels, box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } });
    } else {
      for (const p of pixels) labels[p] = -1;
    }
    next++;
  }
  return { labels, components: comps };
}

/** Decide the change type of a region from its land-cover transitions. */
export function classifyRegion(pixels, clsBefore, clsAfter, mag) {
  const trans = new Map();
  let magSum = 0;
  for (const p of pixels) {
    const k = `${clsBefore[p]}>${clsAfter[p]}`;
    trans.set(k, (trans.get(k) || 0) + 1);
    magSum += mag[p];
  }
  const n = pixels.length;
  const share = (pred) => {
    let s = 0;
    for (const [k, v] of trans) { const [a, b] = k.split('>').map(Number); if (pred(a, b)) s += v; }
    return s / n;
  };
  const { SOIL, VEG, BUILT, WATER } = LandCover;
  const candidates = [
    ['NEW_CONSTRUCTION', share((a, b) => b === BUILT && a !== BUILT)],
    ['DEMOLITION', share((a, b) => a === BUILT && b !== BUILT && b !== WATER)],
    ['VEGETATION_LOSS', share((a, b) => a === VEG && b === SOIL)],
    ['VEGETATION_GAIN', share((a, b) => b === VEG && a !== VEG)],
    ['WATER_CHANGE', share((a, b) => (a === WATER) !== (b === WATER))],
    ['EARTHWORK', share((a, b) => a === b && a === SOIL)],
  ].sort((x, y) => y[1] - x[1]);

  let [type, frac] = candidates[0];
  if (frac < 0.25) type = 'UNKNOWN';
  const intensity = Math.min(1, magSum / n / 90);
  const confidence = +(Math.min(0.99, 0.35 + 0.45 * frac + 0.2 * intensity)).toFixed(3);

  const dominant = [...trans.entries()].sort((x, y) => y[1] - x[1])[0][0].split('>').map(Number);
  return { type, confidence, transition: `${LC_NAMES[dominant[0]]} -> ${LC_NAMES[dominant[1]]}` };
}

// ---------------------------------------------------------------- overlay

async function renderOverlay(afterRgb, w, h, regions, changeMask, parcelMask, outPath) {
  const out = Buffer.from(afterRgb);
  // red tint on changed pixels
  for (let p = 0; p < w * h; p++) {
    if (changeMask[p] > 0) {
      const i = p * 3;
      out[i] = Math.min(255, out[i] * 0.5 + 128);
      out[i + 1] = out[i + 1] * 0.5;
      out[i + 2] = out[i + 2] * 0.5;
    }
  }
  const setPx = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
  };
  // parcel outline (yellow-white)
  if (parcelMask) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (parcelMask[p] && (!parcelMask[p - 1] || !parcelMask[p + 1] || !parcelMask[p - w] || !parcelMask[p + w])) {
        setPx(x, y, [255, 255, 160]);
      }
    }
  }
  // region boxes
  for (const r of regions) {
    const c = TYPE_COLORS[r.type] || TYPE_COLORS.UNKNOWN;
    const { x, y, w: bw, h: bh } = r.pixelBox;
    for (let t = 0; t < 2; t++) {
      for (let xx = x - t; xx < x + bw + t; xx++) { setPx(xx, y - t, c); setPx(xx, y + bh - 1 + t, c); }
      for (let yy = y - t; yy < y + bh + t; yy++) { setPx(x - t, yy, c); setPx(x + bw - 1 + t, yy, c); }
    }
  }
  await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toFile(outPath);
}

// ---------------------------------------------------------------- main entry

/**
 * @param {object}  p
 * @param {object}  p.before   { filePath, width, height, minLon, minLat, maxLon, maxLat }
 * @param {object}  p.after    same shape as before
 * @param {Array}   [p.parcelRing]  GeoJSON outer ring [[lon,lat],...] of the survey parcel
 * @param {string}  [p.overlayPath] where to write the overlay PNG
 * @param {object}  [p.options] { pixelThreshold, minAreaPx, analysisWidth }
 */
export async function detectChanges({ before, after, parcelRing, overlayPath, options = {} }) {
  const pixelThreshold = options.pixelThreshold ?? 40;
  const minAreaPx = options.minAreaPx ?? 60;
  const analysisWidth = options.analysisWidth ?? 1024;

  const extent = intersectExtent(before, after);
  if (!extent) throw Object.assign(new Error('Images do not overlap geographically'), { status: 422 });

  // analysis grid: keep aspect ratio of the overlap area (using after-image resolution)
  const srcW = Math.round(((extent.maxLon - extent.minLon) / (after.maxLon - after.minLon)) * after.width);
  const srcH = Math.round(((extent.maxLat - extent.minLat) / (after.maxLat - after.minLat)) * after.height);
  const scale = Math.min(1, analysisWidth / srcW);
  const W = Math.max(16, Math.round(srcW * scale));
  const H = Math.max(16, Math.round(srcH * scale));
  const grid = { ...extent, width: W, height: H };

  const [rawB, rawA] = await Promise.all([
    loadCropped(before.filePath, before, extent, W, H),
    loadCropped(after.filePath, after, extent, W, H),
  ]);

  const normA = normalizeRadiometry(rawA, rawB);
  const clsB = classifyPixels(rawB, W, H);
  const clsA = classifyPixels(rawA, W, H);   // absolute spectral rules -> raw colours
  const mag = changeMagnitude(rawB, normA, W, H);

  let mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) mask[p] = mag[p] > pixelThreshold ? 1 : 0;
  mask = close(open(mask, W, H, 1), W, H, 2);

  const parcelMask = parcelRing?.length
    ? rasterizePolygon(parcelRing.map(([lon, lat]) => lonLatToPixel(lon, lat, grid)), W, H)
    : null;

  const { components } = connectedComponents(mask, W, H, minAreaPx);
  const pxArea = pixelAreaSqm(grid);

  const regions = components.map((c) => {
    const { type, confidence, transition } = classifyRegion(c.pixels, clsB, clsA, mag);
    let inside = c.pixels.length;
    if (parcelMask) { inside = 0; for (const p of c.pixels) inside += parcelMask[p]; }
    const insideFraction = inside / c.pixels.length;
    return {
      type,
      confidence,
      transition,
      areaSqm: +(c.pixels.length * pxArea).toFixed(1),
      pixelBox: c.box,
      insideFraction: +insideFraction.toFixed(3),
      insideBoundary: insideFraction >= 0.5,
      // partially inside & partially outside the parcel -> potential encroachment
      crossesBoundary: !!parcelMask && insideFraction > 0.05 && insideFraction < 0.95,
      geometry: pixelBoxToPolygon(c.box, grid),
    };
  }).sort((a, b) => b.areaSqm - a.areaSqm);

  // parcel-level statistics
  const zone = parcelMask ?? new Uint8Array(W * H).fill(1);
  let zoneN = 0, changed = 0, builtB = 0, builtA = 0, vegB = 0, vegA = 0;
  for (let p = 0; p < W * H; p++) {
    if (!zone[p]) continue;
    zoneN++;
    if (mask[p]) changed++;
    if (clsB[p] === LandCover.BUILT) builtB++;
    if (clsA[p] === LandCover.BUILT) builtA++;
    if (clsB[p] === LandCover.VEG) vegB++;
    if (clsA[p] === LandCover.VEG) vegA++;
  }
  const pct = (v) => +((100 * v) / Math.max(1, zoneN)).toFixed(2);

  if (overlayPath) {
    await renderOverlay(rawA, W, H, regions, mask, parcelMask, overlayPath);
  }

  return {
    grid: { width: W, height: H, ...extent, pixelAreaSqm: +pxArea.toFixed(3) },
    stats: {
      parcelAreaSqm: +(zoneN * pxArea).toFixed(1),
      changedPercent: pct(changed),
      builtUpBefore: pct(builtB),
      builtUpAfter: pct(builtA),
      vegetationBefore: pct(vegB),
      vegetationAfter: pct(vegA),
      regionCount: regions.length,
      byType: regions.reduce((acc, r) => {
        acc[r.type] = +((acc[r.type] || 0) + r.areaSqm).toFixed(1);
        return acc;
      }, {}),
    },
    regions,
    overlayPath: overlayPath || null,
  };
}
