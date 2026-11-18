import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export function notFound(req: Request, res: Response): void {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.path}` });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(error);

  if (error instanceof ZodError) {
    res.status(400).json({
      message: 'Request validation failed',
      issues: error.issues,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ message: 'A record with that value already exists' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ message: 'Record not found' });
      return;
    }
    if (error.code === 'P2003') {
      res.status(400).json({ message: 'Related record does not exist' });
      return;
    }
  }

  res.status(500).json({ message: 'Internal server error' });
}
