import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { orNotFound } from '../utils/httpError.js';
import { findOwnedProperty } from '../utils/properties.js';
import { parseOrThrow, severity, uuidParam, validateUuidParam } from '../utils/validation.js';

const router = Router();
router.param('id', validateUuidParam);

const alertStatus = z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']);
const listQuery = z.object({ status: alertStatus.optional() });
const createSchema = z.object({
  propertyId: uuidParam,
  title: z.string().min(2),
  message: z.string().min(2),
  type: z.enum(['LAND_COVER_CHANGE', 'VEGETATION_LOSS', 'WATER_CHANGE', 'BUILT_UP_CHANGE', 'CUSTOM']).default('CUSTOM'),
  severity: severity.default('MEDIUM'),
  metadata: z.record(z.string(), z.any()).optional(),
});
const statusSchema = z.object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']) });

/** Status transitions and the timestamp each one records. */
const STATUS_TIMESTAMP = { ACKNOWLEDGED: 'acknowledgedAt', RESOLVED: 'resolvedAt' };

router.get('/', async (req, res) => {
  const { status } = parseOrThrow(listQuery, req.query);
  const alerts = await prisma.alert.findMany({
    where: { property: { ownerId: req.user.sub }, status },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(alerts);
});

router.post('/', async (req, res) => {
  const data = parseOrThrow(createSchema, req.body);
  await findOwnedProperty(data.propertyId, req.user.sub, { id: true });
  res.status(201).json(await prisma.alert.create({ data }));
});

router.patch('/:id/status', async (req, res) => {
  const { status } = parseOrThrow(statusSchema, req.body);
  const alert = prisma.alert.update({
    where: { id: req.params.id, property: { ownerId: req.user.sub } },
    data: { status, [STATUS_TIMESTAMP[status]]: new Date() },
  });
  res.json(await orNotFound(alert, 'Alert not found'));
});

export default router;
