import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('AUDITOR', 'ADMIN'));

router.post(
  '/assignments',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        taxReturnId: z.string().min(1),
        auditorId: z.string().min(1),
      })
      .parse(req.body);
    const [taxReturn, auditor] = await Promise.all([
      prisma.taxReturn.findUnique({
        where: { id: input.taxReturnId },
        select: { id: true, status: true, auditorId: true },
      }),
      prisma.auditor.findUnique({
        where: { id: input.auditorId },
        select: { id: true, status: true, isAvailable: true },
      }),
    ]);

    if (!taxReturn) {
      res.status(404).json({ message: 'Tax return not found' });
      return;
    }
    if (!auditor || auditor.status !== 'VERIFIED' || !auditor.isAvailable) {
      res.status(400).json({ message: 'Auditor is not verified and available' });
      return;
    }
    if (
      taxReturn.status !== 'DOCUMENT_PENDING' &&
      taxReturn.status !== 'UNDER_REVIEW' &&
      taxReturn.status !== 'QUERY_RAISED'
    ) {
      res.status(409).json({
        message: 'Only submitted tax returns can be assigned for audit',
      });
      return;
    }

    const assignment = await prisma.$transaction(async (transaction) => {
      const result = await transaction.auditAssignment.create({
        data: {
          taxReturnId: taxReturn.id,
          auditorId: auditor.id,
          status: 'ASSIGNED',
        },
        include: {
          auditor: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
      await transaction.taxReturn.update({
        where: { id: taxReturn.id },
        data: { auditorId: auditor.id, status: 'UNDER_REVIEW' },
      });
      await transaction.filingHistory.create({
        data: {
          taxReturnId: taxReturn.id,
          previousStatus: taxReturn.status,
          currentStatus: 'UNDER_REVIEW',
          changedBy: req.user!.id,
          remarks: 'Auditor assigned',
        },
      });
      return result;
    });

    res.status(201).json(assignment);
  }),
);

router.get(
  '/assignments',
  asyncHandler(async (req, res) => {
    let where = {};
    if (req.user!.role === 'AUDITOR') {
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

    const assignments = await prisma.auditAssignment.findMany({
      where,
      include: {
        taxReturn: {
          include: {
            financialYear: true,
            customer: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        },
        auditor: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
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
    const input = z
      .object({
        status: z.enum([
          'ASSIGNED',
          'IN_PROGRESS',
          'QUERY_RAISED',
          'APPROVED',
          'COMPLETED',
          'REJECTED',
        ]),
      })
      .parse(req.body);
    const assignment = await prisma.auditAssignment.findUnique({
      where: { id: String(req.params.id) },
      include: { taxReturn: true },
    });
    if (!assignment) {
      res.status(404).json({ message: 'Audit assignment not found' });
      return;
    }
    if (req.user!.role === 'AUDITOR') {
      const auditor = await prisma.auditor.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!auditor || assignment.auditorId !== auditor.id) {
        res.status(403).json({ message: 'Assignment is not assigned to you' });
        return;
      }
    }

    const statusDates = {
      startedAt:
        input.status === 'IN_PROGRESS'
          ? assignment.startedAt ?? new Date()
          : undefined,
      completedAt:
        input.status === 'COMPLETED' ? new Date() : undefined,
    };
    const taxReturnStatus =
      input.status === 'QUERY_RAISED'
        ? 'QUERY_RAISED'
        : input.status === 'APPROVED'
          ? 'APPROVED'
          : input.status === 'REJECTED'
            ? 'REJECTED'
            : null;

    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.auditAssignment.update({
        where: { id: assignment.id },
        data: { status: input.status, ...statusDates },
      });
      if (taxReturnStatus && assignment.taxReturn.status !== taxReturnStatus) {
        await transaction.taxReturn.update({
          where: { id: assignment.taxReturnId },
          data: { status: taxReturnStatus },
        });
        await transaction.filingHistory.create({
          data: {
            taxReturnId: assignment.taxReturnId,
            previousStatus: assignment.taxReturn.status,
            currentStatus: taxReturnStatus,
            changedBy: req.user!.id,
            remarks: `Auditor updated audit status to ${input.status}`,
          },
        });
      }
      return result;
    });
    res.json(updated);
  }),
);

router.post(
  '/assignments/:id/findings',
  authorize('AUDITOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(5000),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
        recommendation: z.string().trim().max(5000).optional(),
      })
      .parse(req.body);
    const assignment = await prisma.auditAssignment.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, auditorId: true },
    });
    if (!assignment) {
      res.status(404).json({ message: 'Audit assignment not found' });
      return;
    }
    if (req.user!.role === 'AUDITOR') {
      const auditor = await prisma.auditor.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!auditor || assignment.auditorId !== auditor.id) {
        res.status(403).json({ message: 'Assignment is not assigned to you' });
        return;
      }
    }
    const finding = await prisma.auditFinding.create({
      data: { ...input, assignmentId: assignment.id },
    });
    res.status(201).json(finding);
  }),
);

router.patch(
  '/assignments/:id/findings/:findingId',
  asyncHandler(async (req, res) => {
    const input = z
      .object({ isResolved: z.boolean() })
      .parse(req.body);
    const finding = await prisma.auditFinding.findFirst({
      where: {
        id: String(req.params.findingId),
        assignmentId: String(req.params.id),
      },
      include: { assignment: { select: { auditorId: true } } },
    });
    if (!finding) {
      res.status(404).json({ message: 'Audit finding not found' });
      return;
    }
    if (req.user!.role === 'AUDITOR') {
      const auditor = await prisma.auditor.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!auditor || finding.assignment.auditorId !== auditor.id) {
        res.status(403).json({ message: 'Finding is not assigned to you' });
        return;
      }
    }
    const updated = await prisma.auditFinding.update({
      where: { id: finding.id },
      data: {
        isResolved: input.isResolved,
        resolvedAt: input.isResolved ? new Date() : null,
      },
    });
    res.json(updated);
  }),
);

router.put(
  '/assignments/:id/report',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        reportNumber: z.string().trim().min(1).max(100).optional(),
        reportUrl: z.string().url().max(2048).optional(),
        remarks: z.string().trim().max(5000).optional(),
      })
      .parse(req.body);
    const assignment = await prisma.auditAssignment.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, auditorId: true },
    });
    if (!assignment) {
      res.status(404).json({ message: 'Audit assignment not found' });
      return;
    }
    if (req.user!.role === 'AUDITOR') {
      const auditor = await prisma.auditor.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!auditor || assignment.auditorId !== auditor.id) {
        res.status(403).json({ message: 'Assignment is not assigned to you' });
        return;
      }
    }
    const report = await prisma.auditReport.upsert({
      where: { assignmentId: assignment.id },
      create: {
        assignmentId: assignment.id,
        reportNumber:
          input.reportNumber ?? `AUD-${randomUUID().slice(0, 12).toUpperCase()}`,
        reportUrl: input.reportUrl,
        remarks: input.remarks,
        issuedAt: new Date(),
      },
      update: {
        reportNumber: input.reportNumber,
        reportUrl: input.reportUrl,
        remarks: input.remarks,
        issuedAt: new Date(),
      },
    });
    res.json(report);
  }),
);

export default router;
