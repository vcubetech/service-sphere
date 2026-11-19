import { Router } from 'express';
import { prisma } from '../config/db.js';
import { findSentinelImages, createNdviThumbnail, compareNdvi } from '../services/gee.js';
const router = Router();
async function ownedProperty(id, userId) { return prisma.property.findFirst({ where: { id, ownerId: userId } }); }
router.get('/properties/:propertyId/sentinel-2', async (req, res) => {
  const property = await ownedProperty(req.params.propertyId, req.user.sub); if (!property) return res.status(404).json({ error: 'Property not found' }); if (!property.boundary) return res.status(400).json({ error: 'Property boundary GeoJSON is required' });
  const { startDate, endDate, cloudMaxPercent = '20' } = req.query; if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
  try { res.json(await findSentinelImages({ geojson: property.boundary, startDate, endDate, cloudMaxPercent: Number(cloudMaxPercent) })); } catch (e) { res.status(503).json({ error: 'Satellite search failed', detail: e.message }); }
});
router.get('/properties/:propertyId/ndvi-thumbnail', async (req, res) => {
  const property = await ownedProperty(req.params.propertyId, req.user.sub); if (!property) return res.status(404).json({ error: 'Property not found' }); if (!property.boundary) return res.status(400).json({ error: 'Property boundary GeoJSON is required' });
  const { startDate, endDate } = req.query; if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
  try { res.json({ thumbnailUrl: await createNdviThumbnail({ geojson: property.boundary, startDate, endDate }) }); } catch (e) { res.status(503).json({ error: 'NDVI thumbnail failed', detail: e.message }); }
});
router.post('/properties/:propertyId/compare-ndvi', async (req, res) => {
  const property = await ownedProperty(req.params.propertyId, req.user.sub); if (!property) return res.status(404).json({ error: 'Property not found' }); if (!property.boundary) return res.status(400).json({ error: 'Property boundary GeoJSON is required' });
  const { beforeStart, beforeEnd, afterStart, afterEnd } = req.body; if (![beforeStart,beforeEnd,afterStart,afterEnd].every(Boolean)) return res.status(400).json({ error: 'beforeStart, beforeEnd, afterStart and afterEnd are required' });
  try { res.json(await compareNdvi({ geojson: property.boundary, beforeStart, beforeEnd, afterStart, afterEnd })); } catch (e) { res.status(503).json({ error: 'NDVI comparison failed', detail: e.message }); }
});
export default router;
