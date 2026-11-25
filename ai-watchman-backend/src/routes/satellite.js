import { Router } from 'express';
import { z } from 'zod';
import { findOwnedBoundary } from '../utils/properties.js';
import { dateString, parseOrThrow, validateUuidParam } from '../utils/validation.js';
import { findSentinelImages, createNdviThumbnail, compareNdvi } from '../services/gee.js';

const router = Router();
router.param('propertyId', validateUuidParam);

const periodQuery = z.object({ startDate: dateString, endDate: dateString });
const sentinelQuery = periodQuery.extend({ cloudMaxPercent: z.coerce.number().min(0).max(100).default(20) });
const compareBody = z.object({ beforeStart: dateString, beforeEnd: dateString, afterStart: dateString, afterEnd: dateString });

/**
 * Run an Earth Engine call, reporting upstream failures as 503 so they are
 * distinguishable from bugs in this service.
 */
async function callEarthEngine(res, failureMessage, fn) {
  try {
    res.json(await fn());
  } catch (error) {
    res.status(503).json({ error: failureMessage, detail: error.message });
  }
}

router.get('/properties/:propertyId/sentinel-2', async (req, res) => {
  const { boundary } = await findOwnedBoundary(req.params.propertyId, req.user.sub);
  const query = parseOrThrow(sentinelQuery, req.query);
  await callEarthEngine(res, 'Satellite search failed', () => findSentinelImages({ geojson: boundary, ...query }));
});

router.get('/properties/:propertyId/ndvi-thumbnail', async (req, res) => {
  const { boundary } = await findOwnedBoundary(req.params.propertyId, req.user.sub);
  const query = parseOrThrow(periodQuery, req.query);
  await callEarthEngine(res, 'NDVI thumbnail failed', async () => ({
    thumbnailUrl: await createNdviThumbnail({ geojson: boundary, ...query }),
  }));
});

router.post('/properties/:propertyId/compare-ndvi', async (req, res) => {
  const { boundary } = await findOwnedBoundary(req.params.propertyId, req.user.sub);
  const body = parseOrThrow(compareBody, req.body);
  await callEarthEngine(res, 'NDVI comparison failed', () => compareNdvi({ geojson: boundary, ...body }));
});

export default router;
