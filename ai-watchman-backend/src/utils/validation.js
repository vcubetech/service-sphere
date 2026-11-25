import { z } from 'zod';
import { HttpError } from './httpError.js';

export const uuidParam = z.uuid();

/** GeoJSON Polygon: each ring needs at least 4 [lng, lat] positions. */
export const geoJsonPolygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)),
});

/** A date string Earth Engine and `new Date()` can both parse, kept as a string. */
export const dateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date');

/** Accepts anything `new Date()` understands and yields a Date. */
export const date = z.coerce.date({ error: 'must be a valid date' });

export const severity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/** Validate `data` against `schema`, throwing a 400 with a readable message on failure. */
export function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
    throw HttpError.badRequest(message);
  }
  return parsed.data;
}

/**
 * Route-param middleware that rejects non-UUID ids with a 400 before they
 * reach Postgres (which would otherwise fail the query with a 500).
 * Usage: `router.param('id', validateUuidParam)`.
 */
export function validateUuidParam(req, res, next, value, name) {
  if (uuidParam.safeParse(value).success) return next();
  next(HttpError.badRequest(`${name} must be a valid UUID`));
}
