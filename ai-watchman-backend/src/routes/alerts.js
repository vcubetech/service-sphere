import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
const router = Router();
router.get('/', async (req, res) => { const status = req.query.status?.toString(); const alerts = await prisma.alert.findMany({ where: { property: { ownerId: req.user.sub }, ...(status ? { status } : {}) }, include: { property: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); res.json(alerts); });
router.post('/', async (req, res) => {
  const parsed = z.object({ propertyId: z.string().uuid(), title: z.string().min(2), message: z.string().min(2), type: z.enum(['LAND_COVER_CHANGE','VEGETATION_LOSS','WATER_CHANGE','BUILT_UP_CHANGE','CUSTOM']).default('CUSTOM'), severity: z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).default('MEDIUM'), metadata: z.record(z.string(), z.any()).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const property = await prisma.property.findFirst({ where: { id: parsed.data.propertyId, ownerId: req.user.sub } }); if (!property) return res.status(404).json({ error: 'Property not found' });
  res.status(201).json(await prisma.alert.create({ data: parsed.data }));
});
router.patch('/:id/status', async (req, res) => {
  const parsed = z.object({ status: z.enum(['ACKNOWLEDGED','RESOLVED']) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const alert = await prisma.alert.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.sub } } }); if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const now = new Date(); const data = parsed.data.status === 'ACKNOWLEDGED' ? { status: 'ACKNOWLEDGED', acknowledgedAt: now } : { status: 'RESOLVED', resolvedAt: now };
  res.json(await prisma.alert.update({ where: { id: alert.id }, data }));
});
export default router;
