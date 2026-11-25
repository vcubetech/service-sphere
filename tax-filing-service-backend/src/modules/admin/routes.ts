import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('ADMIN'));

const yearLabel = z.string().trim().min(4).max(20);
const isoDate = z.string().datetime();

const createYearSchema = z.object({
  financialYear: yearLabel,
  assessmentYear: yearLabel,
  startDate: isoDate,
  endDate: isoDate,
  filingDueDate: isoDate.optional(),
  isActive: z.boolean().optional(),
});

const updateYearSchema = z
  .object({
    financialYear: yearLabel.optional(),
    assessmentYear: yearLabel.optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    filingDueDate: isoDate.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

/** Parses an optional ISO date, preserving `null` (clear) and `undefined` (skip). */
function toDate(value: string | null | undefined): Date | null | undefined {
  return value == null ? value : new Date(value);
}

function assertDateRange(startDate: Date, endDate: Date): void {
  if (startDate >= endDate) {
    throw HttpError.badRequest('endDate must be after startDate');
  }
}

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
    const input = createYearSchema.parse(req.body);
    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);
    assertDateRange(startDate, endDate);

    const year = await prisma.financialYear.create({
      data: {
        ...input,
        startDate,
        endDate,
        filingDueDate: toDate(input.filingDueDate),
      },
    });
    res.status(201).json(year);
  }),
);

router.patch(
  '/financial-years/:id',
  asyncHandler(async (req, res) => {
    const input = updateYearSchema.parse(req.body);
    const existing = await prisma.financialYear.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, startDate: true, endDate: true },
    });
    if (!existing) {
      throw HttpError.notFound('Financial year not found');
    }

    const startDate = toDate(input.startDate) ?? undefined;
    const endDate = toDate(input.endDate) ?? undefined;
    assertDateRange(startDate ?? existing.startDate, endDate ?? existing.endDate);

    const year = await prisma.financialYear.update({
      where: { id: existing.id },
      data: {
        ...input,
        startDate,
        endDate,
        filingDueDate: toDate(input.filingDueDate),
      },
    });
    res.json(year);
  }),
);

export default router;
