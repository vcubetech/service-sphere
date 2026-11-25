import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  FilingType,
  IncomeType,
  ITRForm,
  Prisma,
  TaxRegime,
  TaxReturnStatus,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import {
  assertAssignedAuditor,
  assignedAuditorUserId,
  requireCustomerId,
} from '../../lib/profiles';
import { userSummary } from '../../lib/selects';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';
import { findEditableCustomerReturn, taxReturnScope } from './access';

const router = Router();

router.use(authenticate);

// ---------------------------------------------------------------- schemas

const amount = z.number().nonnegative();

const createReturnSchema = z.object({
  financialYearId: z.string().min(1),
  itrForm: z.nativeEnum(ITRForm).optional(),
  filingType: z.nativeEnum(FilingType).optional(),
  taxRegime: z.nativeEnum(TaxRegime).optional(),
});

const updateReturnSchema = z
  .object({
    itrForm: z.nativeEnum(ITRForm).nullable().optional(),
    filingType: z.nativeEnum(FilingType).optional(),
    taxRegime: z.nativeEnum(TaxRegime).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Admin-driven transitions and the statuses each may start from. */
const ADMIN_TRANSITIONS = {
  READY_TO_FILE: ['APPROVED'],
  FILED: ['READY_TO_FILE'],
  VERIFIED: ['FILED'],
  COMPLETED: ['VERIFIED'],
  REJECTED: ['UNDER_REVIEW', 'QUERY_RAISED', 'APPROVED'],
} as const satisfies Partial<Record<TaxReturnStatus, readonly TaxReturnStatus[]>>;

type AdminTargetStatus = keyof typeof ADMIN_TRANSITIONS;

const statusUpdateSchema = z.object({
  status: z.enum(
    Object.keys(ADMIN_TRANSITIONS) as [AdminTargetStatus, ...AdminTargetStatus[]],
  ),
  acknowledgementNumber: z.string().trim().min(1).max(100).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

const computationSchema = z.object({
  grossTotalIncome: amount,
  exemptIncome: amount,
  deductions: amount,
  taxableIncome: amount,
  basicTax: amount,
  surcharge: amount,
  cess: amount,
  rebate: amount,
  tds: amount,
  advanceTax: amount,
  selfAssessmentTax: amount,
  finalTax: amount,
});

const incomeSchema = z.object({
  incomeType: z.nativeEnum(IncomeType),
  description: z.string().trim().max(500).optional(),
  employerName: z.string().trim().max(200).optional(),
  grossAmount: amount,
  taxableAmount: amount,
  tdsAmount: amount.default(0),
});

const deductionSchema = z
  .object({
    section: z.string().trim().min(1).max(30),
    description: z.string().trim().max(500).optional(),
    amount,
    eligibleAmount: amount,
  })
  .refine((value) => value.eligibleAmount <= value.amount, {
    path: ['eligibleAmount'],
    message: 'Eligible amount cannot exceed the claimed amount',
  });

// ---------------------------------------------------------------- helpers

const ZERO = new Prisma.Decimal(0);

/** Recomputes a return's income/deduction totals from its line items. */
async function refreshReturnTotals(
  transaction: Prisma.TransactionClient,
  taxReturnId: string,
): Promise<void> {
  const [income, deductions] = await Promise.all([
    transaction.incomeDetail.aggregate({
      where: { taxReturnId },
      _sum: { grossAmount: true, taxableAmount: true },
    }),
    transaction.deduction.aggregate({
      where: { taxReturnId },
      _sum: { eligibleAmount: true },
    }),
  ]);
  const totalIncome = income._sum.grossAmount ?? ZERO;
  const totalDeductions = deductions._sum.eligibleAmount ?? ZERO;
  const taxableBeforeDeductions = income._sum.taxableAmount ?? ZERO;

  await transaction.taxReturn.update({
    where: { id: taxReturnId },
    data: {
      totalIncome,
      totalDeductions,
      taxableIncome: Prisma.Decimal.max(
        taxableBeforeDeductions.minus(totalDeductions),
        ZERO,
      ),
    },
  });
}

/** Loads the caller's editable return or throws 404 with the given message. */
async function requireEditableReturn(
  userId: string,
  returnId: string,
  message = 'Editable tax return not found',
) {
  const taxReturn = await findEditableCustomerReturn(userId, returnId);
  if (!taxReturn) {
    throw HttpError.notFound(message);
  }
  return taxReturn;
}

// ---------------------------------------------------------------- routes

router.get(
  '/financial-years',
  asyncHandler(async (_req, res) => {
    const years = await prisma.financialYear.findMany({
      where: { isActive: true },
      orderBy: { startDate: 'desc' },
    });
    res.json(years);
  }),
);

router.post(
  '/',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = createReturnSchema.parse(req.body);
    const customerId = await requireCustomerId(req.user!.id);

    const taxReturn = await prisma.taxReturn.create({
      data: {
        ...input,
        returnNumber: `ITR-${Date.now()}-${randomUUID().slice(0, 8)}`,
        customerId,
        filingHistories: {
          create: {
            currentStatus: 'DRAFT',
            changedBy: req.user!.id,
            remarks: 'Tax return created',
          },
        },
      },
      include: { financialYear: true },
    });
    res.status(201).json(taxReturn);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    const where = taxReturnScope(req.user!);

    const [taxReturns, total] = await Promise.all([
      prisma.taxReturn.findMany({
        where,
        include: { financialYear: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.taxReturn.count({ where }),
    ]);
    res.json({ data: taxReturns, page, limit, total });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const taxReturn = await prisma.taxReturn.findFirst({
      where: { id: String(req.params.id), ...taxReturnScope(req.user!) },
      include: {
        financialYear: true,
        incomeDetails: true,
        deductions: true,
        taxComputation: true,
        documents: true,
        auditAssignment: {
          include: {
            auditor: { include: { user: { select: userSummary } } },
            findings: true,
            report: true,
          },
        },
        filingHistories: { orderBy: { changedAt: 'asc' } },
      },
    });
    if (!taxReturn) {
      throw HttpError.notFound('Tax return not found');
    }
    res.json(taxReturn);
  }),
);

router.patch(
  '/:id',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = updateReturnSchema.parse(req.body);
    const editable = await requireEditableReturn(
      req.user!.id,
      String(req.params.id),
    );

    const taxReturn = await prisma.taxReturn.update({
      where: { id: editable.id },
      data: input,
    });
    res.json(taxReturn);
  }),
);

router.post(
  '/:id/submit',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const editable = await requireEditableReturn(
      req.user!.id,
      String(req.params.id),
      'Submittable tax return not found',
    );

    // Matching on the current status makes a concurrent double-submit fail
    // with 404 instead of writing two history entries.
    const taxReturn = await prisma.taxReturn.update({
      where: { id: editable.id, status: editable.status },
      data: {
        status: 'UNDER_REVIEW',
        filingHistories: {
          create: {
            previousStatus: editable.status,
            currentStatus: 'UNDER_REVIEW',
            changedBy: req.user!.id,
            remarks: 'Submitted by customer for review',
          },
        },
      },
    });
    res.json(taxReturn);
  }),
);

router.patch(
  '/:id/status',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = statusUpdateSchema.parse(req.body);
    const taxReturn = await prisma.taxReturn.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, status: true },
    });
    if (!taxReturn) {
      throw HttpError.notFound('Tax return not found');
    }

    const allowedFrom: readonly TaxReturnStatus[] = ADMIN_TRANSITIONS[input.status];
    if (!allowedFrom.includes(taxReturn.status)) {
      throw HttpError.conflict(
        `Cannot change tax return from ${taxReturn.status} to ${input.status}`,
      );
    }
    if (input.status === 'FILED' && !input.acknowledgementNumber) {
      throw HttpError.badRequest(
        'acknowledgementNumber is required when marking a return filed',
      );
    }

    const now = new Date();
    const updated = await prisma.taxReturn.update({
      where: { id: taxReturn.id, status: taxReturn.status },
      data: {
        status: input.status,
        acknowledgementNumber: input.acknowledgementNumber,
        filedAt: input.status === 'FILED' ? now : undefined,
        verifiedAt: input.status === 'VERIFIED' ? now : undefined,
        filingHistories: {
          create: {
            previousStatus: taxReturn.status,
            currentStatus: input.status,
            changedBy: req.user!.id,
            remarks: input.remarks,
          },
        },
      },
    });
    res.json(updated);
  }),
);

router.put(
  '/:id/computation',
  authorize('AUDITOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = computationSchema.parse(req.body);
    const taxReturn = await prisma.taxReturn.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, ...assignedAuditorUserId },
    });
    if (!taxReturn) {
      throw HttpError.notFound('Tax return not found');
    }
    assertAssignedAuditor(
      req.user!,
      taxReturn.auditor?.userId,
      'Tax return is not assigned to you',
    );

    const [computation] = await prisma.$transaction([
      prisma.taxComputation.upsert({
        where: { taxReturnId: taxReturn.id },
        create: { taxReturnId: taxReturn.id, ...input },
        update: input,
      }),
      prisma.taxReturn.update({
        where: { id: taxReturn.id },
        data: {
          totalIncome: input.grossTotalIncome,
          totalDeductions: input.deductions,
          taxableIncome: input.taxableIncome,
          taxAmount: input.finalTax,
          taxPaid: new Prisma.Decimal(input.tds)
            .plus(input.advanceTax)
            .plus(input.selfAssessmentTax),
        },
      }),
    ]);
    res.json(computation);
  }),
);

router.post(
  '/:id/income',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = incomeSchema.parse(req.body);
    const editable = await requireEditableReturn(
      req.user!.id,
      String(req.params.id),
    );

    const income = await prisma.$transaction(async (transaction) => {
      const created = await transaction.incomeDetail.create({
        data: { ...input, taxReturnId: editable.id },
      });
      await refreshReturnTotals(transaction, editable.id);
      return created;
    });
    res.status(201).json(income);
  }),
);

router.post(
  '/:id/deductions',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = deductionSchema.parse(req.body);
    const editable = await requireEditableReturn(
      req.user!.id,
      String(req.params.id),
    );

    const deduction = await prisma.$transaction(async (transaction) => {
      const created = await transaction.deduction.create({
        data: { ...input, taxReturnId: editable.id },
      });
      await refreshReturnTotals(transaction, editable.id);
      return created;
    });
    res.status(201).json(deduction);
  }),
);

export default router;
