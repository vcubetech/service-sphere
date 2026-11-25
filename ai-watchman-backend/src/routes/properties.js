import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { HttpError } from '../utils/httpError.js';
import { parseOrThrow, validateUuidParam } from '../utils/validation.js';

const router = Router();
router.param('id', validateUuidParam);

const propertySchema = z.object({
  name: z.string().min(2),
  surveyNumber: z.string().trim().min(1),
  description: z.string().optional(),
  address: z.string().optional(),
  areaHectares: z.number().positive().optional(),
});

/** Columns the property API never returns. */
const omit = { boundary: true };

const NOT_FOUND = 'Property not found';

/**
 * Await a single-property write, translating Prisma errors into API errors:
 * P2025 (no owned property matched) -> 404, P2002 (ownerId + surveyNumber taken) -> 409.
 */
async function propertyWrite(promise) {
  try {
    return await promise;
  } catch (error) {
    if (error?.code === 'P2025') throw HttpError.notFound(NOT_FOUND);
    if (error?.code === 'P2002') throw HttpError.conflict('A property with this survey number already exists');
    throw error;
  }
}

router.get('/', async (req, res) => {
  res.json(await prisma.property.findMany({ where: { ownerId: req.user.sub }, omit, orderBy: { createdAt: 'desc' } }));
});

router.post('/', async (req, res) => {
  const data = parseOrThrow(propertySchema, req.body);
  const property = await propertyWrite(prisma.property.create({ data: { ...data, ownerId: req.user.sub }, omit }));
  res.status(201).json(property);
});

router.get('/:id', async (req, res) => {
  const property = await prisma.property.findFirst({ where: { id: req.params.id, ownerId: req.user.sub }, omit });
  if (!property) throw HttpError.notFound(NOT_FOUND);
  res.json(property);
});

router.patch('/:id', async (req, res) => {
  const data = parseOrThrow(propertySchema.partial(), req.body);
  const where = { id: req.params.id, ownerId: req.user.sub };
  res.json(await propertyWrite(prisma.property.update({ where, data, omit })));
});

router.delete('/:id', async (req, res) => {
  const where = { id: req.params.id, ownerId: req.user.sub };
  await propertyWrite(prisma.property.delete({ where, omit }));
  res.status(204).end();
});

export default router;
