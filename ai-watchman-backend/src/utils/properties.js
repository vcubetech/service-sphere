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
