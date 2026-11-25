import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { HttpError } from '../utils/httpError.js';
import { findOwnedProperty } from '../utils/properties.js';
import { date, parseOrThrow, validateUuidParam } from '../utils/validation.js';

const router = Router();
router.param('id', validateUuidParam);
router.param('propertyId', validateUuidParam);

const generateSchema = z
  .object({ periodStart: date, periodEnd: date })
  .refine((data) => data.periodEnd > data.periodStart, { message: 'periodEnd must be after periodStart', path: ['periodEnd'] });

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return counts;
}

router.post('/properties/:propertyId/generate', async (req, res) => {
  const { periodStart, periodEnd } = parseOrThrow(generateSchema, req.body);
  const property = await findOwnedProperty(req.params.propertyId, req.user.sub, { id: true, name: true });

  const propertyId = property.id;
  const [changes, alerts, jobs] = await Promise.all([
    prisma.landChange.findMany({ where: { propertyId, detectedAt: { gte: periodStart, lte: periodEnd } }, orderBy: { detectedAt: 'desc' } }),
    prisma.alert.findMany({ where: { propertyId, createdAt: { gte: periodStart, lte: periodEnd } } }),
    prisma.monitoringJob.findMany({ where: { propertyId, createdAt: { gte: periodStart, lte: periodEnd } } }),
  ]);

  const report = await prisma.monitoringReport.create({
    data: {
      propertyId,
      title: `Monitoring report - ${property.name}`,
      periodStart,
      periodEnd,
      summary: `${changes.length} land-change record(s), ${alerts.length} alert(s), and ${jobs.length} monitoring job(s) were recorded during this period.`,
      metrics: {
        changeCount: changes.length,
        alertCount: alerts.length,
        jobCount: jobs.length,
        severityCounts: countBy(changes, 'severity'),
      },
    },
  });
  res.status(201).json({ report, details: { changes, alerts, jobs } });
});

router.get('/', async (req, res) => {
  const reports = await prisma.monitoringReport.findMany({
    where: { property: { ownerId: req.user.sub } },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { generatedAt: 'desc' },
  });
  res.json(reports);
});

router.get('/:id', async (req, res) => {
  const report = await prisma.monitoringReport.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.sub } } });
  if (!report) throw HttpError.notFound('Report not found');
  res.json(report);
});

export default router;
