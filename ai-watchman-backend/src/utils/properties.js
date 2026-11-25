import { prisma } from '../config/db.js';
import { HttpError } from './httpError.js';

/**
 * Load a property owned by `userId`, or throw a 404.
 * Pass `select` to fetch only the columns the caller needs.
 */
export async function findOwnedProperty(id, userId, select) {
  const property = await prisma.property.findFirst({ where: { id, ownerId: userId }, select });
  if (!property) throw HttpError.notFound('Property not found');
  return property;
}

/** Load an owned property's boundary, or throw if it has none. */
export async function findOwnedBoundary(id, userId, message = 'Property boundary GeoJSON is required') {
  const property = await findOwnedProperty(id, userId, { id: true, boundary: true });
  if (!property.boundary) throw HttpError.badRequest(message);
  return property;
}

/**
 * Average of a polygon's outer-ring vertices as `{ centroidLat, centroidLng }`.
 * GeoJSON rings repeat the first position at the end, so that closing
 * position is skipped to avoid weighting the first vertex twice.
 */
export function polygonCentroid(polygon) {
  const ring = polygon.coordinates[0];
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  const vertices = firstLng === lastLng && firstLat === lastLat ? ring.slice(0, -1) : ring;

  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of vertices) {
    lngSum += lng;
    latSum += lat;
  }
  return { centroidLat: latSum / vertices.length, centroidLng: lngSum / vertices.length };
}
