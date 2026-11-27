import { ZodError } from 'zod';

/** Wrap async route handlers so errors reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validate req[part] with a zod schema and replace it with the parsed value. */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  try {
    req[part === 'query' ? 'validQuery' : part] = schema.parse(req[part]);
    next();
  } catch (e) { next(e); }
};

/** JSON-safe BigInt (PostGIS raw queries may return bigint). */
export function bigintJson(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(JSON.parse(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? Number(v) : v))));
  next();
}

export function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  if (err.code === 'P2002') return res.status(409).json({ error: 'Duplicate record', target: err.meta?.target });
  if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error' });
}
