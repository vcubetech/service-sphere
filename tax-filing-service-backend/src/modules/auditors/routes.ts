import { Router } from 'express';
import { AuditorStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import { userContact } from '../../lib/selects';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate);

const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();

const updateProfileSchema = z
  .object({
    membershipNumber: optionalText(100),
    firmName: optionalText(200),
    qualification: optionalText(200),
    experienceYears: z.number().int().min(0).max(80).optional(),
    city: optionalText(100),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one profile field to update',
  });

const statusSchema = z.object({ status: z.nativeEnum(AuditorStatus) });

router.get(
  '/me',
  authorize('AUDITOR'),
  asyncHandler(async (req, res) => {
    const auditor = await prisma.auditor.findUnique({
      where: { userId: req.user!.id },
      include: { user: { select: userContact } },
    });
    if (!auditor) {
      throw HttpError.notFound('Auditor profile not found');
    }
    res.json(auditor);
  }),
);

router.patch(
  '/me',
  authorize('AUDITOR'),
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    const auditor = await prisma.auditor.update({
      where: { userId: req.user!.id },
      data: input,
    });
    res.json(auditor);
  }),
);

router.get(
  '/',
  authorize('ADMIN'),
  asyncHandler(async (_req, res) => {
    const auditors = await prisma.auditor.findMany({
      include: { user: { select: userContact } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(auditors);
  }),
);

router.patch(
  '/:id/status',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const auditor = await prisma.auditor.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(auditor);
  }),
);

export default router;
