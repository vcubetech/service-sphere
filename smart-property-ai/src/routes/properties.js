import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { ah, validate } from '../middleware/index.js';
import * as geo from '../services/geoService.js';
import { registerImage, listImages } from '../services/imageService.js';
import { runDetection, listDetections } from '../services/detectionService.js';
import { scanProperty } from '../agents/monitoringGraph.js';
import { isValidPolygon } from '../utils/geo.js';

const r = Router();
const upload = multer({
  dest: config.uploadDir + '/tmp',
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, /image\/(png|jpe?g|tiff|webp)/.test(f.mimetype)),
});

const Polygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) })
  .refine(isValidPolygon, 'Polygon outer ring must be closed and have >= 4 points');

const PropertyIn = z.object({
  surveyNumber: z.string().min(1),
  subDivision: z.string().optional(),
  village: z.string().min(1),
  taluk: z.string().optional(),
  district: z.string().min(1),
  state: z.string().min(1),
  ownerName: z.string().min(1),
  ownerContact: z.string().optional(),
  landUse: z.enum(['RESIDENTIAL', 'COMMERCIAL', 'AGRICULTURAL', 'INDUSTRIAL', 'GOVERNMENT', 'VACANT']).default('RESIDENTIAL'),
  boundary: Polygon.optional(),
  metadata: z.record(z.any()).optional(),
});

// ---- CRUD -------------------------------------------------------------------

r.get('/', ah(async (req, res) => {
  const { district, village, landUse, q } = req.query;
  const rows = await prisma.property.findMany({
    where: {
      ...(district && { district: { equals: district, mode: 'insensitive' } }),
      ...(village && { village: { equals: village, mode: 'insensitive' } }),
      ...(landUse && { landUse }),
      ...(q && { OR: [{ surveyNumber: { contains: q } }, { ownerName: { contains: q, mode: 'insensitive' } }] }),
    },
    include: { _count: { select: { alerts: { where: { status: 'OPEN' } }, images: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json(rows);
}));

r.get('/geojson', ah(async (req, res) => res.json(await geo.propertiesFeatureCollection(req.query))));

/** Survey number lookup: /api/properties/survey/123?subDivision=4&village=Yelahanka */
r.get('/survey/:surveyNumber', ah(async (req, res) => {
  const rows = await geo.findBySurveyNumber({ surveyNumber: req.params.surveyNumber, ...req.query });
  if (!rows.length) return res.status(404).json({ error: 'No parcel found for this survey number' });
  res.json(rows);
}));

r.get('/at', ah(async (req, res) => {
  const { lon, lat, radius } = z.object({ lon: z.coerce.number(), lat: z.coerce.number(), radius: z.coerce.number().optional() }).parse(req.query);
  res.json(radius ? await geo.findNearby(lon, lat, radius) : await geo.findByPoint(lon, lat));
}));

r.post('/', validate(PropertyIn), ah(async (req, res) => {
  const { boundary, ...data } = req.body;
  const p = await prisma.property.create({ data });
  if (boundary) await geo.setBoundary(p.id, boundary);
  res.status(201).json(await geo.getProperty(p.id));
}));

r.get('/:id', ah(async (req, res) => {
  const p = await geo.getProperty(req.params.id);
  if (!p) return res.status(404).json({ error: 'Property not found' });
  const [neighbours, openAlerts, projects] = await Promise.all([
    geo.findNeighbours(p.id),
    prisma.alert.findMany({ where: { propertyId: p.id, status: 'OPEN' }, orderBy: { createdAt: 'desc' } }),
    prisma.constructionProject.findMany({ where: { propertyId: p.id }, include: { progress: { orderBy: { recordedAt: 'asc' } } } }),
  ]);
  res.json({ ...p, neighbours, openAlerts, projects });
}));

r.patch('/:id', validate(PropertyIn.partial()), ah(async (req, res) => {
  const { boundary, ...data } = req.body;
  if (Object.keys(data).length) await prisma.property.update({ where: { id: req.params.id }, data });
  if (boundary) await geo.setBoundary(req.params.id, boundary);
  res.json(await geo.getProperty(req.params.id));
}));

r.delete('/:id', ah(async (req, res) => {
  await prisma.property.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

// ---- satellite images ---------------------------------------------------------

const ImageMeta = z.object({
  capturedAt: z.coerce.date(),
  source: z.string().optional(),
  minLon: z.coerce.number(), minLat: z.coerce.number(),
  maxLon: z.coerce.number(), maxLat: z.coerce.number(),
  resolutionM: z.coerce.number().optional(),
  cloudCover: z.coerce.number().min(0).max(100).optional(),
}).refine((m) => m.minLon < m.maxLon && m.minLat < m.maxLat, 'Invalid image extent');

r.get('/:id/images', ah(async (req, res) => res.json(await listImages(req.params.id))));

r.post('/:id/images', upload.single('image'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'multipart field "image" (png/jpg/tiff/webp) is required' });
  try {
    const meta = ImageMeta.parse(req.body);
    const img = await registerImage(req.params.id, { ...meta, filePath: req.file.path });
    res.status(201).json(img);
  } finally {
    fs.rm(req.file.path, { force: true }, () => {});
  }
}));

// ---- change detection & AI scan --------------------------------------------------

const PairIn = z.object({ beforeImageId: z.string().uuid().optional(), afterImageId: z.string().uuid().optional() });

/** Raw change detection only (no alerts). */
r.post('/:id/detect', validate(PairIn), ah(async (req, res) => {
  const out = await runDetection(req.params.id, req.body);
  res.status(201).json({
    detection: { ...out.detection, overlay: `/api/detections/${out.detection.id}/overlay` },
    stats: out.stats,
    regions: out.regions,
    encroachment: out.encroachment,
  });
}));

/** Full agentic pipeline: detect -> construction -> rules -> RAG -> LLM -> alerts. */
r.post('/:id/scan', validate(PairIn), ah(async (req, res) => {
  const out = await scanProperty(req.params.id, req.body);
  res.status(out.error ? 422 : 201).json(out);
}));

r.get('/:id/detections', ah(async (req, res) => res.json(await listDetections(req.params.id))));

r.get('/:id/agent-runs', ah(async (req, res) => res.json(await prisma.agentRun.findMany({
  where: { propertyId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 20,
}))));

export default r;
