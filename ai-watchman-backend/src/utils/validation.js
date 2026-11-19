import { z } from 'zod';
export const uuidParam = z.string().uuid();
export const geoJsonPolygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4) ) });
export function parseOrThrow(schema, data) { const parsed = schema.safeParse(data); if (!parsed.success) { const e = new Error(parsed.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ')); e.statusCode = 400; throw e; } return parsed.data; }
