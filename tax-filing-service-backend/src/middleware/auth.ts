import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { AuthUser } from '../types';

const JWT_ALGORITHM = 'HS256';
const ROLES = new Set<string>(Object.values(Role));

/** Issues a signed access token carrying the user's id, email and role. */
export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    env.JWT_SECRET,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    },
  );
}

/** Verifies a token and returns its user, or null if invalid or expired. */
function verifyAccessToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    });
    if (
      typeof payload === 'string' ||
      typeof payload.id !== 'string' ||
      typeof payload.email !== 'string' ||
      !ROLES.has(payload.role)
    ) {
      return null;
    }
    return { id: payload.id, email: payload.email, role: payload.role as Role };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return null; // also covers TokenExpiredError and NotBeforeError
    }
    throw error;
  }
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

  const user = verifyAccessToken(token);
  if (!user) {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }
  req.user = user;
  next();
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
