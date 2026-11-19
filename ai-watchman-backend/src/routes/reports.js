import { Router } from 'express';
import { prisma } from '../config/db.js';
const router = Router();
router.post('/properties/:propertyId/generate', async (req, res) => {
  const { periodStart, periodEnd } = req.body;
  if (!periodStart || !periodEnd || new Date(periodEnd) <= new Date(periodStart)) return res.status(400).json({ error: 'Valid periodStart and periodEnd are required' });
  const property = await prisma.property.findFirst({ where: { id: req.params.propertyId, ownerId: req.user.sub } }); if (!property) return res.status(404).json({ error: 'Property not found' });
  const from = new Date(periodStart), to = new Date(periodEnd);
  const [changes, alerts, jobs] = await Promise.all([
    prisma.landChange.findMany({ where: { propertyId: property.id, detectedAt: { gte: from, lte: to } }, orderBy: { detectedAt: 'desc' } }),
    prisma.alert.findMany({ where: { propertyId: property.id, createdAt: { gte: from, lte: to } } }),
    prisma.monitoringJob.findMany({ where: { propertyId: property.id, createdAt: { gte: from, lte: to } } })
  ]);
  const summary = `${changes.length} land-change record(s), ${alerts.length} alert(s), and ${jobs.length} monitoring job(s) were recorded during this period.`;
  const report = await prisma.monitoringReport.create({ data: { propertyId: property.id, title: `Monitoring report - ${property.name}`, periodStart: from, periodEnd: to, summary, metrics: { changeCount: changes.length, alertCount: alerts.length, jobCount: jobs.length, severityCounts: changes.reduce((a,c)=>(a[c.severity]=(a[c.severity]||0)+1,a),{}) } } });
  res.status(201).json({ report, details: { changes, alerts, jobs } });
});
router.get('/', async (req, res) => { const reports = await prisma.monitoringReport.findMany({ where: { property: { ownerId: req.user.sub } }, include: { property: { select: { id: true, name: true } } }, orderBy: { generatedAt: 'desc' } }); res.json(reports); });
router.get('/:id', async (req, res) => { const report = await prisma.monitoringReport.findFirst({ where: { id: req.params.id, property: { ownerId: req.user.sub } } }); if (!report) return res.status(404).json({ error: 'Report not found' }); res.json(report); });
export default router;
