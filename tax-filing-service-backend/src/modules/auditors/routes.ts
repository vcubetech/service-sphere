import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';

const router = Router();

router.get(
  '/me',
  authenticate,
  authorize('AUDITOR'),
  asyncHandler(async (req, res) => {
    const auditor = await prisma.auditor.findUnique({
      where: { userId: req.user!.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
    if (!auditor) {
      res.status(404).json({ message: 'Auditor profile not found' });
      return;
    }
    res.json(auditor);
  }),
);

router.patch(
  '/me',
  authenticate,
  authorize('AUDITOR'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        membershipNumber: z.string().trim().min(1).max(100).nullable().optional(),
        firmName: z.string().trim().min(1).max(200).nullable().optional(),
        qualification: z.string().trim().min(1).max(200).nullable().optional(),
        experienceYears: z.number().int().min(0).max(80).optional(),
        city: z.string().trim().min(1).max(100).nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'Provide at least one profile field to update',
      })
      .parse(req.body);

    const auditor = await prisma.auditor.update({
      where: { userId: req.user!.id },
      data: input,
    });
    res.json(auditor);
  }),
);

router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (_req, res) => {
    const auditors = await prisma.auditor.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(auditors);
  }),
);

router.patch(
  '/:id/status',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED']),
      })
      .parse(req.body);
    const auditor = await prisma.auditor.update({
      where: { id: String(req.params.id) },
      data: { status: input.status },
    });
    res.json(auditor);
  }),
);

export default router;
