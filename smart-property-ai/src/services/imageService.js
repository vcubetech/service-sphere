import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

/**
 * Register a satellite / drone image for a property.
 * `file` can be a multer file ({ path }) or an existing path on disk.
 */
export async function registerImage(propertyId, { filePath, capturedAt, source, minLon, minLat, maxLon, maxLat, resolutionM, cloudCover }) {
  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) throw Object.assign(new Error('Unreadable image'), { status: 400 });

  // keep a normalised PNG copy so every downstream step reads the same format
  const dest = path.join(config.uploadDir, propertyId);
  fs.mkdirSync(dest, { recursive: true });
  const stored = path.join(dest, `${new Date(capturedAt).toISOString().slice(0, 10)}_${Date.now()}.png`);
  await sharp(filePath).png().toFile(stored);

  return prisma.satelliteImage.create({
    data: {
      propertyId,
      capturedAt: new Date(capturedAt),
      source: source || 'UPLOAD',
      filePath: stored,
      width: meta.width,
      height: meta.height,
      minLon: Number(minLon), minLat: Number(minLat), maxLon: Number(maxLon), maxLat: Number(maxLat),
      resolutionM: resolutionM != null ? Number(resolutionM) : null,
      cloudCover: cloudCover != null ? Number(cloudCover) : null,
    },
  });
}

export function listImages(propertyId) {
  return prisma.satelliteImage.findMany({ where: { propertyId }, orderBy: { capturedAt: 'asc' } });
}

/** Latest two usable images (cloud cover < 30%) for a property. */
export async function latestPair(propertyId) {
  const imgs = await prisma.satelliteImage.findMany({
    where: { propertyId, OR: [{ cloudCover: null }, { cloudCover: { lt: 30 } }] },
    orderBy: { capturedAt: 'desc' },
    take: 2,
  });
  return imgs.length === 2 ? { before: imgs[1], after: imgs[0] } : null;
}
