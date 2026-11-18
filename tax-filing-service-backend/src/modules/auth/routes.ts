import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';

const router = Router();

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
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

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const result = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: input.role,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      });

      const profile =
        input.role === 'CUSTOMER'
          ? await transaction.customer.create({
              data: {
                userId: user.id,
                panNumber: input.panNumber!,
              },
            })
          : await transaction.auditor.create({
              data: {
                userId: user.id,
                membershipNumber: input.membershipNumber,
                firmName: input.firmName,
                qualification: input.qualification,
                experienceYears: input.experienceYears,
                city: input.city,
              },
            });

      return { user, profile };
    });

    res.status(201).json({
      ...result,
      message:
        input.role === 'AUDITOR'
          ? 'Registration successful. Auditor verification is pending.'
          : 'Registration successful.',
    });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        email: z.string().trim().email().transform((email) => email.toLowerCase()),
        password: z.string().min(1),
      })
      .parse(req.body);

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

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      secret,
      {
        expiresIn: (process.env.JWT_EXPIRES_IN ||
          '1d') as jwt.SignOptions['expiresIn'],
      },
    );

    res.json({
      token,
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
