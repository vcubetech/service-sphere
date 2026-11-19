import { env } from '../config/env.js';
let eeModule;
let initPromise;
async function getEe() {
  if (!env.GEE_PROJECT_ID || !env.GEE_SERVICE_ACCOUNT || !env.GEE_PRIVATE_KEY) throw new Error('Google Earth Engine is not configured. Set GEE_PROJECT_ID, GEE_SERVICE_ACCOUNT and GEE_PRIVATE_KEY.');
  if (!eeModule) { const mod = await import('@google/earthengine'); eeModule = mod.default || mod; }
  if (!initPromise) initPromise = new Promise((resolve, reject) => {
    const key = env.GEE_PRIVATE_KEY.replace(/\\n/g, '\n');
    eeModule.data.authenticateViaPrivateKey({ client_email: env.GEE_SERVICE_ACCOUNT, private_key: key }, () => eeModule.initialize(null, null, resolve, reject, null, env.GEE_PROJECT_ID), reject);
  });
  await initPromise;
  return eeModule;
}
const evaluate = obj => new Promise((resolve, reject) => obj.evaluate((value, error) => error ? reject(new Error(error)) : resolve(value)));
export async function findSentinelImages({ geojson, startDate, endDate, cloudMaxPercent = 20 }) {
  const ee = await getEe();
  const geometry = ee.Geometry(geojson);
  const collection = ee.ImageCollection(env.SENTINEL_COLLECTION).filterBounds(geometry).filterDate(startDate, endDate).filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMaxPercent)).sort('system:time_start');
  const list = collection.toList(100);
  const features = ee.FeatureCollection(list.map(image => ee.Feature(null, { id: ee.Image(image).id(), date: ee.Date(ee.Image(image).get('system:time_start')).format('YYYY-MM-dd'), cloudPercent: ee.Image(image).get('CLOUDY_PIXEL_PERCENTAGE') })));
  return evaluate(features);
}
export async function createNdviThumbnail({ geojson, startDate, endDate, cloudMaxPercent = 30 }) {
  const ee = await getEe();
  const geometry = ee.Geometry(geojson);
  const image = ee.ImageCollection(env.SENTINEL_COLLECTION).filterBounds(geometry).filterDate(startDate, endDate).filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMaxPercent)).median();
  const ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI').clip(geometry);
  return ndvi.getThumbURL({ region: geometry, min: -0.2, max: 0.8, palette: ['brown', 'yellow', 'green'], dimensions: 1024 });
}
export async function compareNdvi({ geojson, beforeStart, beforeEnd, afterStart, afterEnd }) {
  const ee = await getEe();
  const geometry = ee.Geometry(geojson);
  const getNdvi = (start, end) => ee.ImageCollection(env.SENTINEL_COLLECTION).filterBounds(geometry).filterDate(start, end).median().normalizedDifference(['B8', 'B4']).rename('NDVI').clip(geometry);
  const before = getNdvi(beforeStart, beforeEnd), after = getNdvi(afterStart, afterEnd);
  const delta = after.subtract(before).rename('NDVI_CHANGE');
  const stats = await evaluate(delta.reduceRegion({ reducer: ee.Reducer.mean(), geometry, scale: 10, maxPixels: 1e9 }));
  const thumbUrl = delta.getThumbURL({ region: geometry, min: -0.5, max: 0.5, palette: ['red', 'white', 'green'], dimensions: 1024 });
  return { meanNdviChange: stats.NDVI_CHANGE ?? null, changeThumbnailUrl: thumbUrl };
}
