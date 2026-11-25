import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { monitoringQueue } from '../config/queue.js';
import { HttpError } from '../utils/httpError.js';
import { findOwnedBoundary } from '../utils/properties.js';
import { parseOrThrow, validateUuidParam } from '../utils/validation.js';

const router = Router();
router.param('id', validateUuidParam);
router.param('propertyId', validateUuidParam);

const createSchema = z
  .object({
    startDate: z.iso.datetime().transform((value) => new Date(value)),
    endDate: z.iso.datetime().transform((value) => new Date(value)),
    cloudMaxPercent: z.number().min(0).max(100).default(20),
  })
  .refine((data) => data.endDate > data.startDate, { message: 'endDate must be after startDate', path: ['endDate'] });

router.post('/properties/:propertyId/jobs', async (req, res) => {
  const data = parseOrThrow(createSchema, req.body);
  const property = await findOwnedBoundary(req.params.propertyId, req.user.sub, 'Property boundary GeoJSON is required before monitoring');
  const job = await prisma.monitoringJob.create({ data: { ...data, propertyId: property.id, requestedById: req.user.sub } });

  try {
    await monitoringQueue.add('monitor-property', { monitoringJobId: job.id }, { jobId: job.id });
  } catch (error) {
    // Without this the job would stay QUEUED forever with nothing to process it.
    await prisma.monitoringJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorMessage: 'Failed to enqueue job' } });
    throw error;
  }
  res.status(202).json({ message: 'Monitoring job queued', job });
});

router.get('/jobs', async (req, res) => {
  const jobs = await prisma.monitoringJob.findMany({
    where: { property: { ownerId: req.user.sub } },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(jobs);
});

router.get('/jobs/:id', async (req, res) => {
  const job = await prisma.monitoringJob.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.sub } } });
  if (!job) throw HttpError.notFound('Monitoring job not found');
  res.json(job);
});

export default router;
