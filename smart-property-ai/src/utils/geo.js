// Pixel <-> geographic coordinate helpers for north-up georeferenced images (EPSG:4326)

/** Convert pixel (x,y) to [lon, lat] given image size and extent. */
export function pixelToLonLat(x, y, img) {
  const lon = img.minLon + (x / img.width) * (img.maxLon - img.minLon);
  const lat = img.maxLat - (y / img.height) * (img.maxLat - img.minLat);
  return [lon, lat];
}

/** Convert [lon, lat] to pixel (x,y). */
export function lonLatToPixel(lon, lat, img) {
  const x = ((lon - img.minLon) / (img.maxLon - img.minLon)) * img.width;
  const y = ((img.maxLat - lat) / (img.maxLat - img.minLat)) * img.height;
  return [x, y];
}

/** Pixel bounding box -> closed GeoJSON polygon ring. */
export function pixelBoxToPolygon(box, img) {
  const { x, y, w, h } = box;
  const ring = [
    pixelToLonLat(x, y, img),
    pixelToLonLat(x + w, y, img),
    pixelToLonLat(x + w, y + h, img),
    pixelToLonLat(x, y + h, img),
  ];
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** Approximate ground area (m²) of one pixel for an image extent. */
export function pixelAreaSqm(img) {
  const midLat = ((img.minLat + img.maxLat) / 2) * (Math.PI / 180);
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos(midLat);
  const pxW = ((img.maxLon - img.minLon) / img.width) * mPerDegLon;
  const pxH = ((img.maxLat - img.minLat) / img.height) * mPerDegLat;
  return pxW * pxH;
}

/** Validate a GeoJSON Polygon (outer ring closed, >= 4 points). */
export function isValidPolygon(geojson) {
  if (!geojson || geojson.type !== 'Polygon' || !Array.isArray(geojson.coordinates)) return false;
  const ring = geojson.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1];
}

/** Rasterise a polygon ring (pixel coords) into a Uint8Array mask (1 = inside). Even-odd scanline fill. */
export function rasterizePolygon(ringPx, width, height) {
  const mask = new Uint8Array(width * height);
  const n = ringPx.length;
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = ringPx[i];
      const [xj, yj] = ringPx[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}
