import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { parseOrThrow } from '../utils/validation.js';
const router = Router();
const registerSchema = z.object({ name: z.string().min(2), email: z.email(), password: z.string().min(8) });
router.post('/register', async (req, res) => {
  const data = parseOrThrow(registerSchema, req.body);
  const exists = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (exists) return res.status(409).json({ error: 'Email already registered' });
  const user = await prisma.user.create({ data: { name: data.name, email: data.email.toLowerCase(), passwordHash: await bcrypt.hash(data.password, 12) }, select: { id: true, name: true, email: true, role: true, createdAt: true } });
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
  res.status(201).json({ user, token });
});
router.post('/login', async (req, res) => {
  const data = parseOrThrow(z.object({ email: z.email(), password: z.string().min(1) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
});
export default router;
