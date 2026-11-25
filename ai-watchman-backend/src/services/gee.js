import { env } from '../config/env.js';

let initPromise;

/** Load and authenticate the Earth Engine client once; retry on the next call if that fails. */
function getEe() {
  if (!env.GEE_PROJECT_ID || !env.GEE_SERVICE_ACCOUNT || !env.GEE_PRIVATE_KEY) {
    return Promise.reject(new Error('Google Earth Engine is not configured. Set GEE_PROJECT_ID, GEE_SERVICE_ACCOUNT and GEE_PRIVATE_KEY.'));
  }
  initPromise ??= initialize().catch((error) => {
    initPromise = undefined; // don't cache a failed login for the lifetime of the process
    throw error;
  });
  return initPromise;
}

async function initialize() {
  const mod = await import('@google/earthengine');
  const ee = mod.default ?? mod;
  const credentials = { client_email: env.GEE_SERVICE_ACCOUNT, private_key: env.GEE_PRIVATE_KEY.replace(/\\n/g, '\n') };
  await new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(credentials, () => ee.initialize(null, null, resolve, reject, null, env.GEE_PROJECT_ID), reject);
  });
  return ee;
}

/** Callback-to-promise adapter for EE's `(value, error)` callbacks. */
function settle(resolve, reject) {
  return (value, error) => (error ? reject(new Error(error)) : resolve(value));
}

const evaluate = (eeObject) => new Promise((resolve, reject) => eeObject.evaluate(settle(resolve, reject)));

// Passing a callback is essential: without one, getThumbURL makes a synchronous
// HTTP request that blocks the Node.js event loop for every other request.
const thumbUrl = (image, params) => new Promise((resolve, reject) => image.getThumbURL(params, settle(resolve, reject)));

function sentinelImages(ee, geometry, startDate, endDate, cloudMaxPercent) {
  const collection = ee.ImageCollection(env.SENTINEL_COLLECTION).filterBounds(geometry).filterDate(startDate, endDate);
  return cloudMaxPercent === undefined ? collection : collection.filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', cloudMaxPercent));
}

const ndvi = (image, geometry) => image.normalizedDifference(['B8', 'B4']).rename('NDVI').clip(geometry);

export async function findSentinelImages({ geojson, startDate, endDate, cloudMaxPercent = 20 }) {
  const ee = await getEe();
  const geometry = ee.Geometry(geojson);
  const images = sentinelImages(ee, geometry, startDate, endDate, cloudMaxPercent).sort('system:time_start').toList(100);
  const features = ee.FeatureCollection(
    images.map((item) => {
      const image = ee.Image(item);
      return ee.Feature(null, {
        id: image.id(),
        date: ee.Date(image.get('system:time_start')).format('YYYY-MM-dd'),
        cloudPercent: image.get('CLOUDY_PIXEL_PERCENTAGE'),
      });
    }),
  );
  return evaluate(features);
}

export async function createNdviThumbnail({ geojson, startDate, endDate, cloudMaxPercent = 30 }) {
  const ee = await getEe();
  const geometry = ee.Geometry(geojson);
  const image = ndvi(sentinelImages(ee, geometry, startDate, endDate, cloudMaxPercent).median(), geometry);
  return thumbUrl(image, { region: geometry, min: -0.2, max: 0.8, palette: ['brown', 'yellow', 'green'], dimensions: 1024 });
}

export async function compareNdvi({ geojson, beforeStart, beforeEnd, afterStart, afterEnd }) {
  const ee = await getEe();
  const geometry = ee.Geometry(geojson);
  const periodNdvi = (start, end) => ndvi(sentinelImages(ee, geometry, start, end).median(), geometry);
  const delta = periodNdvi(afterStart, afterEnd).subtract(periodNdvi(beforeStart, beforeEnd)).rename('NDVI_CHANGE');

  const [stats, changeThumbnailUrl] = await Promise.all([
    evaluate(delta.reduceRegion({ reducer: ee.Reducer.mean(), geometry, scale: 10, maxPixels: 1e9 })),
    thumbUrl(delta, { region: geometry, min: -0.5, max: 0.5, palette: ['red', 'white', 'green'], dimensions: 1024 }),
  ]);
  return { meanNdviChange: stats.NDVI_CHANGE ?? null, changeThumbnailUrl };
}
