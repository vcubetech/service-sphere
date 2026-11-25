import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError';

export function notFound(req: Request, res: Response): void {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.path}` });
}

/** Prisma error codes that indicate a client mistake rather than a bug. */
const PRISMA_CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
  P2002: { status: 409, message: 'A record with that value already exists' },
  P2003: { status: 400, message: 'Related record does not exist' },
  P2025: { status: 404, message: 'Record not found' },
};

/**
 * Client errors raised by Express/body-parser (malformed JSON, payload too
 * large, unsupported encoding, ...) carry an HTTP status and `expose: true`.
 */
interface ExposedClientError {
  status: number;
  message: string;
  type?: string;
  expose: true;
}

function isExposedClientError(error: unknown): error is ExposedClientError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as Partial<ExposedClientError>;
  return (
    candidate.expose === true &&
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500
  );
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      message: 'Request validation failed',
      issues: error.issues,
    });
    return;
  }

  if (isExposedClientError(error)) {
    res.status(error.status).json({
      message:
        error.type === 'entity.parse.failed'
          ? 'Malformed JSON in request body'
          : error.message,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_CLIENT_ERRORS[error.code];
    if (mapped) {
      res.status(mapped.status).json({ message: mapped.message });
      return;
    }
  }

  // Only unexpected failures are logged; client errors above are routine.
  console.error(error);
  res.status(500).json({ message: 'Internal server error' });
}
