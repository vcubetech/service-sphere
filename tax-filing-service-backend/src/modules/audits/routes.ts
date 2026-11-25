import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  AuditStatus,
  FindingSeverity,
  Prisma,
  TaxReturnStatus,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import { assertAssignedAuditor, assignedAuditorUserId } from '../../lib/profiles';
import { userSummary } from '../../lib/selects';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';
import { AuthUser } from '../../types';

const router = Router();

router.use(authenticate, authorize('AUDITOR', 'ADMIN'));

// ---------------------------------------------------------------- schemas

const assignmentSchema = z.object({
  taxReturnId: z.string().min(1),
  auditorId: z.string().min(1),
});

const assignmentStatusSchema = z.object({
  status: z.enum([
    'ASSIGNED',
    'IN_PROGRESS',
    'QUERY_RAISED',
    'APPROVED',
    'COMPLETED',
    'REJECTED',
  ]),
});

const findingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  severity: z.nativeEnum(FindingSeverity).optional(),
  recommendation: z.string().trim().max(5000).optional(),
});

const reportSchema = z.object({
  reportNumber: z.string().trim().min(1).max(100).optional(),
  reportUrl: z.string().url().max(2048).optional(),
  remarks: z.string().trim().max(5000).optional(),
});

// ---------------------------------------------------------------- helpers

/** Tax-return statuses from which a return can be sent for audit. */
const ASSIGNABLE_RETURN_STATUSES: TaxReturnStatus[] = [
  'DOCUMENT_PENDING',
  'UNDER_REVIEW',
  'QUERY_RAISED',
];

/** Audit outcomes that also move the tax return to a new status. */
const RETURN_STATUS_FOR_AUDIT_STATUS: Partial<Record<AuditStatus, TaxReturnStatus>> = {
  QUERY_RAISED: 'QUERY_RAISED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const auditorWithUser = {
  include: { user: { select: userSummary } },
} satisfies Prisma.AuditorDefaultArgs;

/**
 * Loads an assignment the caller may act on: admins get any, auditors only
 * their own. Throws 404/403 otherwise.
 */
async function requireAccessibleAssignment(user: AuthUser, id: string) {
  const assignment = await prisma.auditAssignment.findUnique({
    where: { id },
    include: {
      taxReturn: { select: { status: true } },
      ...assignedAuditorUserId,
    },
  });
  if (!assignment) {
    throw HttpError.notFound('Audit assignment not found');
  }
  assertAssignedAuditor(
    user,
    assignment.auditor.userId,
    'Assignment is not assigned to you',
  );
  return assignment;
}

// ---------------------------------------------------------------- routes

router.post(
  '/assignments',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = assignmentSchema.parse(req.body);
    const [taxReturn, auditor] = await Promise.all([
      prisma.taxReturn.findUnique({
        where: { id: input.taxReturnId },
        select: { id: true, status: true },
      }),
      prisma.auditor.findUnique({
        where: { id: input.auditorId },
        select: { id: true, status: true, isAvailable: true },
      }),
    ]);

    if (!taxReturn) {
      throw HttpError.notFound('Tax return not found');
    }
    if (!auditor || auditor.status !== 'VERIFIED' || !auditor.isAvailable) {
      throw HttpError.badRequest('Auditor is not verified and available');
    }
    if (!ASSIGNABLE_RETURN_STATUSES.includes(taxReturn.status)) {
      throw HttpError.conflict(
        'Only submitted tax returns can be assigned for audit',
      );
    }

    const [assignment] = await prisma.$transaction([
      prisma.auditAssignment.create({
        data: {
          taxReturnId: taxReturn.id,
          auditorId: auditor.id,
          status: 'ASSIGNED',
        },
        include: { auditor: auditorWithUser },
      }),
      prisma.taxReturn.update({
        where: { id: taxReturn.id },
        data: {
          auditorId: auditor.id,
          status: 'UNDER_REVIEW',
          filingHistories: {
            create: {
              previousStatus: taxReturn.status,
              currentStatus: 'UNDER_REVIEW',
              changedBy: req.user!.id,
              remarks: 'Auditor assigned',
            },
          },
        },
      }),
    ]);

    res.status(201).json(assignment);
  }),
);

router.get(
  '/assignments',
  asyncHandler(async (req, res) => {
    const where: Prisma.AuditAssignmentWhereInput =
      req.user!.role === 'AUDITOR'
        ? { auditor: { is: { userId: req.user!.id } } }
        : {};

    const assignments = await prisma.auditAssignment.findMany({
      where,
      include: {
        taxReturn: {
          include: {
            financialYear: true,
            customer: { include: { user: { select: userSummary } } },
          },
        },
        auditor: auditorWithUser,
        findings: true,
        report: true,
      },
      orderBy: { assignedAt: 'desc' },
    });
    res.json(assignments);
  }),
);

router.patch(
  '/assignments/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = assignmentStatusSchema.parse(req.body);
    const assignment = await requireAccessibleAssignment(
      req.user!,
      req.params.id,
    );

    const now = new Date();
    const updateAssignment = prisma.auditAssignment.update({
      where: { id: assignment.id },
      data: {
        status,
        startedAt:
          status === 'IN_PROGRESS' ? (assignment.startedAt ?? now) : undefined,
        completedAt: status === 'COMPLETED' ? now : undefined,
      },
    });

    const returnStatus = RETURN_STATUS_FOR_AUDIT_STATUS[status];
    const previousReturnStatus = assignment.taxReturn.status;
    if (!returnStatus || returnStatus === previousReturnStatus) {
      res.json(await updateAssignment);
      return;
    }

    const [updated] = await prisma.$transaction([
      updateAssignment,
      prisma.taxReturn.update({
        where: { id: assignment.taxReturnId },
        data: {
          status: returnStatus,
          filingHistories: {
            create: {
              previousStatus: previousReturnStatus,
              currentStatus: returnStatus,
              changedBy: req.user!.id,
              remarks: `Auditor updated audit status to ${status}`,
            },
          },
        },
      }),
    ]);
    res.json(updated);
  }),
);

router.post(
  '/assignments/:id/findings',
  asyncHandler(async (req, res) => {
    const input = findingSchema.parse(req.body);
    const assignment = await requireAccessibleAssignment(
      req.user!,
      req.params.id,
    );

    const finding = await prisma.auditFinding.create({
      data: { ...input, assignmentId: assignment.id },
    });
    res.status(201).json(finding);
  }),
);

router.patch(
  '/assignments/:id/findings/:findingId',
  asyncHandler(async (req, res) => {
    const { isResolved } = z.object({ isResolved: z.boolean() }).parse(req.body);
    const finding = await prisma.auditFinding.findFirst({
      where: {
        id: req.params.findingId,
        assignmentId: req.params.id,
      },
      select: {
        id: true,
        assignment: { select: assignedAuditorUserId },
      },
    });
    if (!finding) {
      throw HttpError.notFound('Audit finding not found');
    }
    assertAssignedAuditor(
      req.user!,
      finding.assignment.auditor.userId,
      'Finding is not assigned to you',
    );

    const updated = await prisma.auditFinding.update({
      where: { id: finding.id },
      data: { isResolved, resolvedAt: isResolved ? new Date() : null },
    });
    res.json(updated);
  }),
);

router.put(
  '/assignments/:id/report',
  asyncHandler(async (req, res) => {
    const input = reportSchema.parse(req.body);
    const assignment = await requireAccessibleAssignment(
      req.user!,
      req.params.id,
    );

    const issuedAt = new Date();
    const report = await prisma.auditReport.upsert({
      where: { assignmentId: assignment.id },
      create: {
        ...input,
        assignmentId: assignment.id,
        reportNumber:
          input.reportNumber ?? `AUD-${randomUUID().slice(0, 12).toUpperCase()}`,
        issuedAt,
      },
      update: { ...input, issuedAt },
    });
    res.json(report);
  }),
);

export default router;
