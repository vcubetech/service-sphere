import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate, signAccessToken } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';

const router = Router();

const BCRYPT_ROUNDS = 12;

const email = z.string().trim().email().transform((value) => value.toLowerCase());

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email,
    phone: z.string().trim().min(7).max(20).optional(),
    password: z.string().min(8).max(128),
    role: z.enum(['CUSTOMER', 'AUDITOR']).default('CUSTOMER'),
    panNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
      .optional(),
    membershipNumber: z.string().trim().min(1).max(100).optional(),
    firmName: z.string().trim().min(1).max(200).optional(),
    qualification: z.string().trim().min(1).max(200).optional(),
    experienceYears: z.number().int().min(0).max(80).optional(),
    city: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((input, context) => {
    if (input.role === 'CUSTOMER' && !input.panNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panNumber'],
        message: 'PAN number is required for customer registration',
      });
    }
  });

const loginSchema = z.object({
  email,
  password: z.string().min(1),
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, role, panNumber, ...auditorProfile } =
      registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // The user and its role profile are created together in one nested write.
    const { customer, auditor, ...user } = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        role,
        ...(role === 'CUSTOMER'
          ? { customer: { create: { panNumber: panNumber! } } }
          : { auditor: { create: auditorProfile } }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        customer: true,
        auditor: true,
      },
    });

    res.status(201).json({
      user,
      profile: customer ?? auditor,
      message:
        role === 'AUDITOR'
          ? 'Registration successful. Auditor verification is pending.'
          : 'Registration successful.',
    });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ message: 'Account disabled' });
      return;
    }

    res.json({
      token: signAccessToken(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        customer: true,
        auditor: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json(user);
  }),
);

export default router;
