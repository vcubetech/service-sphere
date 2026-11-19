import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { monitoringQueue } from '../config/queue.js';
import { parseOrThrow } from '../utils/validation.js';
const router = Router();
const createSchema = z.object({ startDate: z.iso.datetime(), endDate: z.iso.datetime(), cloudMaxPercent: z.number().min(0).max(100).default(20) });
router.post('/properties/:propertyId/jobs', async (req, res) => {
  const data = parseOrThrow(createSchema, req.body);
  const property = await prisma.property.findFirst({ where: { id: req.params.propertyId, ownerId: req.user.sub } }); if (!property) return res.status(404).json({ error: 'Property not found' });
  if (!property.boundary) return res.status(400).json({ error: 'Property boundary GeoJSON is required before monitoring' });
  if (new Date(data.endDate) <= new Date(data.startDate)) return res.status(400).json({ error: 'endDate must be after startDate' });
  const job = await prisma.monitoringJob.create({ data: { propertyId: property.id, requestedById: req.user.sub, startDate: new Date(data.startDate), endDate: new Date(data.endDate), cloudMaxPercent: data.cloudMaxPercent } });
  await monitoringQueue.add('monitor-property', { monitoringJobId: job.id }, { jobId: job.id });
  res.status(202).json({ message: 'Monitoring job queued', job });
});
router.get('/jobs', async (req, res) => {
  const jobs = await prisma.monitoringJob.findMany({ where: { property: { ownerId: req.user.sub } }, include: { property: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }); res.json(jobs);
});
router.get('/jobs/:id', async (req, res) => {
  const job = await prisma.monitoringJob.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.sub } } }); if (!job) return res.status(404).json({ error: 'Monitoring job not found' }); res.json(job);
});
export default router;
