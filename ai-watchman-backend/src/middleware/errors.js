import { env } from '../config/env.js';

/** Prisma error codes that indicate a client mistake rather than a server bug. */
const PRISMA_CLIENT_ERRORS = {
  P2002: { statusCode: 409, message: 'A record with that value already exists' },
  P2003: { statusCode: 400, message: 'Related record does not exist' },
  P2025: { statusCode: 404, message: 'Record not found' },
};

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

/** Resolve any thrown value to `{ statusCode, message }`. */
function toHttpError(err) {
  if (PRISMA_CLIENT_ERRORS[err?.code]) return PRISMA_CLIENT_ERRORS[err.code];

  // HttpError / parseOrThrow set `statusCode`; body-parser sets `status` with `expose: true`
  // for malformed JSON (400), oversized bodies (413), bad encodings (415), etc.
  const statusCode = err?.statusCode ?? (err?.expose ? err.status : undefined);
  if (statusCode >= 400 && statusCode < 500) {
    const message = err.type === 'entity.parse.failed' ? 'Malformed JSON in request body' : err.message;
    return { statusCode, message };
  }
  return { statusCode: 500, message: 'Internal server error' };
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by their 4 arguments.
export function errorHandler(err, req, res, next) {
  const { statusCode, message } = toHttpError(err);
  // Client errors are expected; only log failures that point at a server problem.
  if (statusCode >= 500) console.error(err);
  res.status(statusCode).json({
    error: message,
    ...(env.NODE_ENV === 'development' && statusCode >= 500 ? { detail: err?.message } : {}),
  });
}
