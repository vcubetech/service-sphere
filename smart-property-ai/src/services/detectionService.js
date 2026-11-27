// Runs image change detection for a property and persists results (+ PostGIS geometries)
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { detectChanges } from './changeDetection.js';
import { getProperty, setRegionGeometry, encroachmentReport } from './geoService.js';
import { latestPair } from './imageService.js';

export async function runDetection(propertyId, { beforeImageId, afterImageId } = {}) {
  const property = await getProperty(propertyId);
  if (!property) throw Object.assign(new Error('Property not found'), { status: 404 });

  let pair;
  if (beforeImageId && afterImageId) {
    const [before, after] = await Promise.all([
      prisma.satelliteImage.findFirstOrThrow({ where: { id: beforeImageId, propertyId } }),
      prisma.satelliteImage.findFirstOrThrow({ where: { id: afterImageId, propertyId } }),
    ]);
    pair = before.capturedAt <= after.capturedAt ? { before, after } : { before: after, after: before };
  } else {
    pair = await latestPair(propertyId);
  }
  if (!pair) throw Object.assign(new Error('At least two images are required for comparison'), { status: 422 });

  const overlayDir = path.join(config.uploadDir, propertyId, 'overlays');
  fs.mkdirSync(overlayDir, { recursive: true });
  const overlayPath = path.join(overlayDir, `${pair.before.id.slice(0, 8)}_${pair.after.id.slice(0, 8)}.png`);

  const result = await detectChanges({
    before: pair.before,
    after: pair.after,
    parcelRing: property.boundary?.coordinates?.[0],
    overlayPath,
    options: config.changeDetection,
  });

  const s = result.stats;
  const detection = await prisma.changeDetection.create({
    data: {
      propertyId,
      beforeImageId: pair.before.id,
      afterImageId: pair.after.id,
      changedPercent: s.changedPercent,
      builtUpBefore: s.builtUpBefore,
      builtUpAfter: s.builtUpAfter,
      vegetationBefore: s.vegetationBefore,
      vegetationAfter: s.vegetationAfter,
      overlayPath,
      summary: summarise(s, result.regions, pair),
    },
  });

  for (const r of result.regions) {
    const row = await prisma.changeRegion.create({
      data: {
        detectionId: detection.id,
        type: r.type,
        confidence: r.confidence,
        areaSqm: r.areaSqm,
        pixelBox: { ...r.pixelBox, transition: r.transition, insideFraction: r.insideFraction, crossesBoundary: r.crossesBoundary },
        insideBoundary: r.insideBoundary,
      },
    });
    await setRegionGeometry(row.id, r.geometry);
  }

  const encroachment = property.boundary ? await encroachmentReport(detection.id) : [];
  return { detection, stats: s, regions: result.regions, encroachment, property, images: pair };
}

function summarise(s, regions, pair) {
  const days = Math.round((pair.after.capturedAt - pair.before.capturedAt) / 86_400_000);
  const parts = Object.entries(s.byType).map(([t, a]) => `${t.replace(/_/g, ' ').toLowerCase()} ${a} m²`);
  return `Over ${days} days, ${s.changedPercent}% of the parcel changed. Built-up ${s.builtUpBefore}% -> ${s.builtUpAfter}%, ` +
    `vegetation ${s.vegetationBefore}% -> ${s.vegetationAfter}%. ` +
    (parts.length ? `Detected: ${parts.join(', ')}.` : 'No significant change regions.') +
    (regions.some((r) => r.crossesBoundary) ? ' At least one change crosses the parcel boundary.' : '');
}

export function listDetections(propertyId) {
  return prisma.changeDetection.findMany({
    where: { propertyId },
    include: { regions: true, beforeImage: true, afterImage: true },
    orderBy: { createdAt: 'desc' },
  });
}
