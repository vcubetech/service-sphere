import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('ADMIN'));

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [customers, auditors, taxReturns, payments] = await Promise.all([
      prisma.customer.count(),
      prisma.auditor.count(),
      prisma.taxReturn.count(),
      prisma.payment.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true },
      }),
    ]);

    res.json({
      customers,
      auditors,
      taxReturns,
      paidPaymentsTotal: payments._sum.amount ?? 0,
    });
  }),
);

router.get(
  '/financial-years',
  asyncHandler(async (_req, res) => {
    const years = await prisma.financialYear.findMany({
      orderBy: { startDate: 'desc' },
    });
    res.json(years);
  }),
);

router.post(
  '/financial-years',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        financialYear: z.string().trim().min(4).max(20),
        assessmentYear: z.string().trim().min(4).max(20),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        filingDueDate: z.string().datetime().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);
    if (startDate >= endDate) {
      res.status(400).json({ message: 'endDate must be after startDate' });
      return;
    }

    const year = await prisma.financialYear.create({
      data: {
        ...input,
        startDate,
        endDate,
        filingDueDate: input.filingDueDate
          ? new Date(input.filingDueDate)
          : undefined,
      },
    });
    res.status(201).json(year);
  }),
);

router.patch(
  '/financial-years/:id',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        financialYear: z.string().trim().min(4).max(20).optional(),
        assessmentYear: z.string().trim().min(4).max(20).optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        filingDueDate: z.string().datetime().nullable().optional(),
        isActive: z.boolean().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'Provide at least one field to update',
      })
      .parse(req.body);
    const existing = await prisma.financialYear.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!existing) {
      res.status(404).json({ message: 'Financial year not found' });
      return;
    }
    const startDate = input.startDate
      ? new Date(input.startDate)
      : existing.startDate;
    const endDate = input.endDate ? new Date(input.endDate) : existing.endDate;
    if (startDate >= endDate) {
      res.status(400).json({ message: 'endDate must be after startDate' });
      return;
    }

    const year = await prisma.financialYear.update({
      where: { id: existing.id },
      data: {
        ...input,
        startDate: input.startDate ? startDate : undefined,
        endDate: input.endDate ? endDate : undefined,
        filingDueDate:
          input.filingDueDate === undefined
            ? undefined
            : input.filingDueDate
              ? new Date(input.filingDueDate)
              : null,
      },
    });
    res.json(year);
  }),
);

export default router;
