import { Router } from 'express';
import { prisma } from '../config/db.js';
const router = Router();
router.get('/', async (req, res) => {
  const propertyId = req.query.propertyId?.toString();
  const rows = await prisma.landChange.findMany({ where: { property: { ownerId: req.user.sub }, ...(propertyId ? { propertyId } : {}) }, include: { property: { select: { id: true, name: true } } }, orderBy: { detectedAt: 'desc' }, take: 200 }); res.json(rows);
});
router.post('/', async (req, res) => {
  const { propertyId, changeType, severity = 'MEDIUM', confidence, areaHectares, description, geometry, beforeImageDate, afterImageDate, beforeImageUrl, afterImageUrl } = req.body;
  const property = await prisma.property.findFirst({ where: { id: propertyId, ownerId: req.user.sub } }); if (!property) return res.status(404).json({ error: 'Property not found' });
  if (!changeType) return res.status(400).json({ error: 'changeType is required' });
  const row = await prisma.landChange.create({ data: { propertyId, changeType, severity, confidence, areaHectares, description, geometry, beforeImageDate: beforeImageDate ? new Date(beforeImageDate) : undefined, afterImageDate: afterImageDate ? new Date(afterImageDate) : undefined, beforeImageUrl, afterImageUrl } }); res.status(201).json(row);
});
router.get('/:id', async (req, res) => { const row = await prisma.landChange.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.sub } } }); if (!row) return res.status(404).json({ error: 'Change record not found' }); res.json(row); });
export default router;
