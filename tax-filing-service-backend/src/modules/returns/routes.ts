import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';
import { editableCustomerReturn, visibleReturnWhere } from './access';

const router = Router();

router.use(authenticate);

async function refreshReturnTotals(
  transaction: Prisma.TransactionClient,
  taxReturnId: string,
): Promise<void> {
  const [income, deductions] = await Promise.all([
    transaction.incomeDetail.aggregate({
      where: { taxReturnId },
      _sum: {
        grossAmount: true,
        taxableAmount: true,
      },
    }),
    transaction.deduction.aggregate({
      where: { taxReturnId },
      _sum: { eligibleAmount: true },
    }),
  ]);
  const totalIncome = income._sum.grossAmount ?? new Prisma.Decimal(0);
  const totalDeductions =
    deductions._sum.eligibleAmount ?? new Prisma.Decimal(0);
  const taxableIncome = income._sum.taxableAmount ?? new Prisma.Decimal(0);

  await transaction.taxReturn.update({
    where: { id: taxReturnId },
    data: {
      totalIncome,
      totalDeductions,
      taxableIncome: taxableIncome.greaterThan(totalDeductions)
        ? taxableIncome.minus(totalDeductions)
        : new Prisma.Decimal(0),
    },
  });
}

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
    const input = z
      .object({
        financialYearId: z.string().min(1),
        itrForm: z
          .enum(['ITR_1', 'ITR_2', 'ITR_3', 'ITR_4', 'ITR_5', 'ITR_6', 'ITR_7'])
          .optional(),
        filingType: z.enum(['ORIGINAL', 'REVISED', 'BELATED', 'UPDATED']).optional(),
        taxRegime: z.enum(['OLD_REGIME', 'NEW_REGIME']).optional(),
      })
      .parse(req.body);

    const customer = await prisma.customer.findUnique({
      where: { userId: req.user!.id },
      select: { id: true },
    });
    if (!customer) {
      res.status(404).json({ message: 'Customer profile not found' });
      return;
    }

    const taxReturn = await prisma.$transaction(async (transaction) => {
      const created = await transaction.taxReturn.create({
        data: {
          returnNumber: `ITR-${Date.now()}-${randomUUID().slice(0, 8)}`,
          customerId: customer.id,
          financialYearId: input.financialYearId,
          itrForm: input.itrForm,
          filingType: input.filingType,
          taxRegime: input.taxRegime,
        },
        include: { financialYear: true },
      });
      await transaction.filingHistory.create({
        data: {
          taxReturnId: created.id,
          currentStatus: 'DRAFT',
          changedBy: req.user!.id,
          remarks: 'Tax return created',
        },
      });
      return created;
    });
    res.status(201).json(taxReturn);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);

    let where: { customerId?: string; auditorId?: string } = {};
    if (req.user!.role === 'CUSTOMER') {
      const customer = await prisma.customer.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!customer) {
        res.status(404).json({ message: 'Customer profile not found' });
        return;
      }
      where = { customerId: customer.id };
    } else if (req.user!.role === 'AUDITOR') {
      const auditor = await prisma.auditor.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!auditor) {
        res.status(404).json({ message: 'Auditor profile not found' });
        return;
      }
      where = { auditorId: auditor.id };
    }

    const [taxReturns, total] = await prisma.$transaction([
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
    const where = await visibleReturnWhere(
      req.user!.id,
      req.user!.role,
      String(req.params.id),
    );
    if (!where) {
      res.status(404).json({ message: 'Tax return not found' });
      return;
    }

    const taxReturn = await prisma.taxReturn.findFirst({
      where,
      include: {
        financialYear: true,
        incomeDetails: true,
        deductions: true,
        taxComputation: true,
        documents: true,
        auditAssignment: {
          include: {
            auditor: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
            findings: true,
            report: true,
          },
        },
        filingHistories: { orderBy: { changedAt: 'asc' } },
      },
    });
    if (!taxReturn) {
      res.status(404).json({ message: 'Tax return not found' });
      return;
    }
    res.json(taxReturn);
  }),
);

router.patch(
  '/:id',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        itrForm: z
          .enum(['ITR_1', 'ITR_2', 'ITR_3', 'ITR_4', 'ITR_5', 'ITR_6', 'ITR_7'])
          .nullable()
          .optional(),
        filingType: z.enum(['ORIGINAL', 'REVISED', 'BELATED', 'UPDATED']).optional(),
        taxRegime: z.enum(['OLD_REGIME', 'NEW_REGIME']).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'Provide at least one field to update',
      })
      .parse(req.body);
    const editable = await editableCustomerReturn(
      req.user!.id,
      String(req.params.id),
    );
    if (!editable) {
      res.status(404).json({ message: 'Editable tax return not found' });
      return;
    }

    const taxReturn = await prisma.taxReturn.update({
      where: { id: editable.taxReturn.id },
      data: input,
    });
    res.json(taxReturn);
  }),
);

router.post(
  '/:id/submit',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const editable = await editableCustomerReturn(
      req.user!.id,
      String(req.params.id),
    );
    if (!editable) {
      res.status(404).json({ message: 'Submittable tax return not found' });
      return;
    }

    const taxReturn = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.taxReturn.update({
        where: { id: editable.taxReturn.id },
        data: { status: 'UNDER_REVIEW' },
      });
      await transaction.filingHistory.create({
        data: {
          taxReturnId: updated.id,
          previousStatus: editable.taxReturn.status,
          currentStatus: 'UNDER_REVIEW',
          changedBy: req.user!.id,
          remarks: 'Submitted by customer for review',
        },
      });
      return updated;
    });
    res.json(taxReturn);
  }),
);

router.patch(
  '/:id/status',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        status: z.enum([
          'READY_TO_FILE',
          'FILED',
          'VERIFIED',
          'COMPLETED',
          'REJECTED',
        ]),
        acknowledgementNumber: z.string().trim().min(1).max(100).optional(),
        remarks: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);
    const taxReturn = await prisma.taxReturn.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, status: true },
    });
    if (!taxReturn) {
      res.status(404).json({ message: 'Tax return not found' });
      return;
    }

    const allowedPreviousStatuses: Record<string, string[]> = {
      READY_TO_FILE: ['APPROVED'],
      FILED: ['READY_TO_FILE'],
      VERIFIED: ['FILED'],
      COMPLETED: ['VERIFIED'],
      REJECTED: ['UNDER_REVIEW', 'QUERY_RAISED', 'APPROVED'],
    };
    if (!allowedPreviousStatuses[input.status].includes(taxReturn.status)) {
      res.status(409).json({
        message: `Cannot change tax return from ${taxReturn.status} to ${input.status}`,
      });
      return;
    }
    if (
      input.status === 'FILED' &&
      !input.acknowledgementNumber
    ) {
      res.status(400).json({
        message: 'acknowledgementNumber is required when marking a return filed',
      });
      return;
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.taxReturn.update({
        where: { id: taxReturn.id },
        data: {
          status: input.status,
          acknowledgementNumber: input.acknowledgementNumber,
          filedAt: input.status === 'FILED' ? new Date() : undefined,
          verifiedAt: input.status === 'VERIFIED' ? new Date() : undefined,
        },
      });
      await transaction.filingHistory.create({
        data: {
          taxReturnId: taxReturn.id,
          previousStatus: taxReturn.status,
          currentStatus: input.status,
          changedBy: req.user!.id,
          remarks: input.remarks,
        },
      });
      return result;
    });
    res.json(updated);
  }),
);

router.put(
  '/:id/computation',
  authorize('AUDITOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const amount = z.number().nonnegative();
    const input = z
      .object({
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
      })
      .parse(req.body);
    const taxReturn = await prisma.taxReturn.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, auditorId: true },
    });
    if (!taxReturn) {
      res.status(404).json({ message: 'Tax return not found' });
      return;
    }

    if (req.user!.role === 'AUDITOR') {
      const auditor = await prisma.auditor.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!auditor || taxReturn.auditorId !== auditor.id) {
        res.status(403).json({ message: 'Tax return is not assigned to you' });
        return;
      }
    }

    const computation = await prisma.$transaction(async (transaction) => {
      const result = await transaction.taxComputation.upsert({
        where: { taxReturnId: taxReturn.id },
        create: { taxReturnId: taxReturn.id, ...input },
        update: input,
      });
      await transaction.taxReturn.update({
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
      });
      return result;
    });
    res.json(computation);
  }),
);

router.post(
  '/:id/income',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        incomeType: z
          .enum(['SALARY', 'HOUSE_PROPERTY', 'BUSINESS', 'CAPITAL_GAINS', 'OTHER_SOURCES']),
        description: z.string().trim().max(500).optional(),
        employerName: z.string().trim().max(200).optional(),
        grossAmount: z.number().nonnegative(),
        taxableAmount: z.number().nonnegative(),
        tdsAmount: z.number().nonnegative().default(0),
      })
      .parse(req.body);
    const editable = await editableCustomerReturn(
      req.user!.id,
      String(req.params.id),
    );
    if (!editable) {
      res.status(404).json({ message: 'Editable tax return not found' });
      return;
    }
    const income = await prisma.$transaction(async (transaction) => {
      const created = await transaction.incomeDetail.create({
        data: { ...input, taxReturnId: editable.taxReturn.id },
      });
      await refreshReturnTotals(transaction, editable.taxReturn.id);
      return created;
    });
    res.status(201).json(income);
  }),
);

router.post(
  '/:id/deductions',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        section: z.string().trim().min(1).max(30),
        description: z.string().trim().max(500).optional(),
        amount: z.number().nonnegative(),
        eligibleAmount: z.number().nonnegative(),
      })
      .refine((value) => value.eligibleAmount <= value.amount, {
        path: ['eligibleAmount'],
        message: 'Eligible amount cannot exceed the claimed amount',
      })
      .parse(req.body);
    const editable = await editableCustomerReturn(
      req.user!.id,
      String(req.params.id),
    );
    if (!editable) {
      res.status(404).json({ message: 'Editable tax return not found' });
      return;
    }
    const deduction = await prisma.$transaction(async (transaction) => {
      const created = await transaction.deduction.create({
        data: { ...input, taxReturnId: editable.taxReturn.id },
      });
      await refreshReturnTotals(transaction, editable.taxReturn.id);
      return created;
    });
    res.status(201).json(deduction);
  }),
);

export default router;
