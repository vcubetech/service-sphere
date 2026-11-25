import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { orNotFound } from '../utils/httpError.js';
import { findOwnedProperty, polygonCentroid } from '../utils/properties.js';
import { geoJsonPolygon, parseOrThrow, validateUuidParam } from '../utils/validation.js';

const router = Router();
router.param('id', validateUuidParam);

const propertySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  address: z.string().optional(),
  areaHectares: z.number().positive().optional(),
  boundary: geoJsonPolygon.optional(),
});

/** Keep the stored centroid in sync whenever a boundary is written. */
function withCentroid(data) {
  return data.boundary ? { ...data, ...polygonCentroid(data.boundary) } : data;
}

router.get('/', async (req, res) => {
  res.json(await prisma.property.findMany({ where: { ownerId: req.user.sub }, orderBy: { createdAt: 'desc' } }));
});

router.post('/', async (req, res) => {
  const data = parseOrThrow(propertySchema, req.body);
  const property = await prisma.property.create({ data: { ...withCentroid(data), ownerId: req.user.sub } });
  res.status(201).json(property);
});

router.get('/:id', async (req, res) => {
  res.json(await findOwnedProperty(req.params.id, req.user.sub));
});

router.patch('/:id', async (req, res) => {
  const data = parseOrThrow(propertySchema.partial(), req.body);
  const where = { id: req.params.id, ownerId: req.user.sub };
  res.json(await orNotFound(prisma.property.update({ where, data: withCentroid(data) }), 'Property not found'));
});

router.delete('/:id', async (req, res) => {
  const where = { id: req.params.id, ownerId: req.user.sub };
  await orNotFound(prisma.property.delete({ where }), 'Property not found');
  res.status(204).end();
});

export default router;
