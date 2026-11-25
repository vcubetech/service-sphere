import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { parseOrThrow } from '../utils/validation.js';

const router = Router();

const email = z.email().transform((value) => value.toLowerCase());
const registerSchema = z.object({ name: z.string().min(2), email, password: z.string().min(8) });
const loginSchema = z.object({ email, password: z.string().min(1) });

const publicUser = { id: true, name: true, email: true, role: true, createdAt: true };

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

router.post('/register', async (req, res) => {
  const data = parseOrThrow(registerSchema, req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);
  let user;
  try {
    // The unique index on email is the source of truth, so concurrent sign-ups cannot both succeed.
    user = await prisma.user.create({ data: { name: data.name, email: data.email, passwordHash }, select: publicUser });
  } catch (error) {
    if (error?.code === 'P2002') throw HttpError.conflict('Email already registered');
    throw error;
  }
  res.status(201).json({ user, token: issueToken(user) });
});

router.post('/login', async (req, res) => {
  const data = parseOrThrow(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email }, select: { ...publicUser, passwordHash: true } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token: issueToken(user) });
});

export default router;
