import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (
      typeof payload === 'string' ||
      typeof payload.id !== 'string' ||
      typeof payload.email !== 'string' ||
      !Object.values(Role).includes(payload.role as Role)
    ) {
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role as Role,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }
    next(error);
  }
}

export const authorize =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: 'You do not have permission' });
      return;
    }
    next();
  };
