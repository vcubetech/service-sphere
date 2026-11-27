// Detections, construction, alerts, knowledge base (RAG), AI assistant, dashboard stats
import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { ah, validate } from '../middleware/index.js';
import { encroachmentReport } from '../services/geoService.js';
import { listAlerts, updateAlertStatus } from '../services/alertService.js';
import { projectTimeline, expectedProgress } from '../services/constructionService.js';
import { addDocument, similaritySearch } from '../rag/vectorStore.js';
import { askAssistant } from '../agents/assistantAgent.js';

// ---- detections ---------------------------------------------------------------
export const detections = Router();

detections.get('/:id', ah(async (req, res) => {
  const d = await prisma.changeDetection.findUniqueOrThrow({
    where: { id: req.params.id }, include: { regions: true, beforeImage: true, afterImage: true, alerts: true },
  });
  res.json({ ...d, encroachment: await encroachmentReport(d.id), overlay: `/api/detections/${d.id}/overlay` });
}));

detections.get('/:id/overlay', ah(async (req, res) => {
  const d = await prisma.changeDetection.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!d.overlayPath || !fs.existsSync(d.overlayPath)) return res.status(404).json({ error: 'Overlay not available' });
  res.sendFile(d.overlayPath);
}));

export const images = Router();
images.get('/:id/file', ah(async (req, res) => {
  const img = await prisma.satelliteImage.findUniqueOrThrow({ where: { id: req.params.id } });
  res.sendFile(img.filePath);
}));

// ---- construction -------------------------------------------------------------
export const construction = Router();

const ProjectIn = z.object({
  propertyId: z.string().uuid(),
  permitNumber: z.string().optional(),
  description: z.string().optional(),
  permittedBuiltUpPct: z.number().min(0).max(100),
  permittedFloors: z.number().int().positive().optional(),
  targetBuiltUpPct: z.number().min(0).max(100),
  startDate: z.coerce.date(),
  expectedEndDate: z.coerce.date(),
}).refine((p) => p.expectedEndDate > p.startDate, 'expectedEndDate must be after startDate');

construction.get('/', ah(async (req, res) => {
  const rows = await prisma.constructionProject.findMany({
    where: req.query.status ? { status: req.query.status } : {},
    include: {
      property: { select: { surveyNumber: true, subDivision: true, village: true, ownerName: true } },
      progress: { orderBy: { recordedAt: 'desc' }, take: 1 },
    },
    orderBy: { startDate: 'desc' },
  });
  res.json(rows.map((p) => ({ ...p, expectedNowPct: expectedProgress(p) })));
}));

construction.post('/', validate(ProjectIn), ah(async (req, res) => {
  res.status(201).json(await prisma.constructionProject.create({ data: req.body }));
}));

construction.get('/:id', ah(async (req, res) => {
  const p = await projectTimeline(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json({ ...p, expectedNowPct: expectedProgress(p) });
}));

// ---- alerts -------------------------------------------------------------------
export const alerts = Router();

alerts.get('/', ah(async (req, res) => res.json(await listAlerts(req.query))));

alerts.patch('/:id', validate(z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']) })),
  ah(async (req, res) => res.json(await updateAlertStatus(req.params.id, req.body.status))));

// ---- knowledge base (RAG) ---------------------------------------------------------
export const knowledge = Router();

knowledge.post('/', validate(z.object({
  source: z.string().min(1), title: z.string().min(1), text: z.string().min(20), metadata: z.record(z.any()).optional(),
})), ah(async (req, res) => {
  const chunks = await addDocument(req.body);
  res.status(201).json({ source: req.body.source, chunks });
}));

knowledge.get('/search', ah(async (req, res) => {
  const { q, k } = z.object({ q: z.string().min(2), k: z.coerce.number().max(20).optional() }).parse(req.query);
  res.json(await similaritySearch(q, { k }));
}));

knowledge.get('/sources', ah(async (_req, res) => {
  res.json(await prisma.knowledgeChunk.groupBy({ by: ['source'], _count: { _all: true } }));
}));

// ---- AI assistant -------------------------------------------------------------------
export const agent = Router();

agent.post('/chat', validate(z.object({
  question: z.string().min(2),
  propertyId: z.string().uuid().optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(20).optional(),
})), ah(async (req, res) => res.json(await askAssistant(req.body.question, req.body))));

// ---- dashboard --------------------------------------------------------------------
export const dashboard = Router();

dashboard.get('/stats', ah(async (_req, res) => {
  const [properties, images, detections, openAlerts, bySeverity, byType, projects] = await Promise.all([
    prisma.property.count(),
    prisma.satelliteImage.count(),
    prisma.changeDetection.count(),
    prisma.alert.count({ where: { status: 'OPEN' } }),
    prisma.alert.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } }),
    prisma.alert.groupBy({ by: ['type'], where: { status: 'OPEN' }, _count: { _all: true } }),
    prisma.constructionProject.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  res.json({
    properties, images, detections, openAlerts,
    alertsBySeverity: Object.fromEntries(bySeverity.map((x) => [x.severity, x._count._all])),
    alertsByType: Object.fromEntries(byType.map((x) => [x.type, x._count._all])),
    projectsByStatus: Object.fromEntries(projects.map((x) => [x.status, x._count._all])),
  });
}));
