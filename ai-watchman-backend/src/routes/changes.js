import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { HttpError } from '../utils/httpError.js';
import { findOwnedProperty } from '../utils/properties.js';
import { date, parseOrThrow, severity, uuidParam, validateUuidParam } from '../utils/validation.js';

const router = Router();
router.param('id', validateUuidParam);

const listQuery = z.object({ propertyId: uuidParam.optional() });
const createSchema = z.object({
  propertyId: uuidParam,
  changeType: z.string().min(1),
  severity: severity.default('MEDIUM'),
  confidence: z.number().optional(),
  areaHectares: z.number().optional(),
  description: z.string().optional(),
  geometry: z.record(z.string(), z.any()).optional(),
  beforeImageDate: date.optional(),
  afterImageDate: date.optional(),
  beforeImageUrl: z.string().optional(),
  afterImageUrl: z.string().optional(),
});

router.get('/', async (req, res) => {
  const { propertyId } = parseOrThrow(listQuery, req.query);
  const rows = await prisma.landChange.findMany({
    where: { property: { ownerId: req.user.sub }, propertyId },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { detectedAt: 'desc' },
    take: 200,
  });
  res.json(rows);
});

router.post('/', async (req, res) => {
  const data = parseOrThrow(createSchema, req.body);
  await findOwnedProperty(data.propertyId, req.user.sub, { id: true });
  res.status(201).json(await prisma.landChange.create({ data }));
});

router.get('/:id', async (req, res) => {
  const row = await prisma.landChange.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.sub } } });
  if (!row) throw HttpError.notFound('Change record not found');
  res.json(row);
});

export default router;
