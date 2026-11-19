import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { parseOrThrow } from '../utils/validation.js';
const router = Router();
const propertySchema = z.object({ name: z.string().min(2), description: z.string().optional(), address: z.string().optional(), areaHectares: z.number().positive().optional(), boundary: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)) }).optional() });
router.get('/', async (req, res) => {
  const rows = await prisma.property.findMany({ where: { ownerId: req.user.sub }, orderBy: { createdAt: 'desc' } }); res.json(rows);
});
router.post('/', async (req, res) => {
  const data = parseOrThrow(propertySchema, req.body);
  const property = await prisma.property.create({ data: { ...data, ownerId: req.user.sub, centroidLat: data.boundary ? data.boundary.coordinates[0].reduce((s,p)=>s+p[1],0)/data.boundary.coordinates[0].length : null, centroidLng: data.boundary ? data.boundary.coordinates[0].reduce((s,p)=>s+p[0],0)/data.boundary.coordinates[0].length : null } });
  res.status(201).json(property);
});
router.get('/:id', async (req, res) => {
  const p = await prisma.property.findFirst({ where: { id: req.params.id, ownerId: req.user.sub } }); if (!p) return res.status(404).json({ error: 'Property not found' }); res.json(p);
});
router.patch('/:id', async (req, res) => {
  const data = parseOrThrow(propertySchema.partial(), req.body);
  const owned = await prisma.property.findFirst({ where: { id: req.params.id, ownerId: req.user.sub } }); if (!owned) return res.status(404).json({ error: 'Property not found' });
  res.json(await prisma.property.update({ where: { id: owned.id }, data }));
});
router.delete('/:id', async (req, res) => {
  const owned = await prisma.property.findFirst({ where: { id: req.params.id, ownerId: req.user.sub } }); if (!owned) return res.status(404).json({ error: 'Property not found' });
  await prisma.property.delete({ where: { id: owned.id } }); res.status(204).end();
});
export default router;
