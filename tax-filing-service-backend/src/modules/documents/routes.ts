import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    let where = {};
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
      where = { taxReturn: { is: { auditorId: auditor.id } } };
    }

    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(documents);
  }),
);

router.post(
  '/',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        taxReturnId: z.string().min(1).optional(),
        documentType: z.enum([
          'PAN_CARD',
          'AADHAAR_CARD',
          'FORM_16',
          'BANK_STATEMENT',
          'SALARY_SLIP',
          'FORM_26AS',
          'AIS',
          'TIS',
          'INVESTMENT_PROOF',
          'BUSINESS_PROOF',
          'BALANCE_SHEET',
          'PROFIT_LOSS',
          'AUDIT_REPORT',
          'OTHER',
        ]),
        fileName: z.string().trim().min(1).max(255),
        fileUrl: z.string().url().max(2048),
        fileSize: z.number().int().positive().optional(),
        mimeType: z.string().trim().max(100).optional(),
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
    if (input.taxReturnId) {
      const taxReturn = await prisma.taxReturn.findFirst({
        where: { id: input.taxReturnId, customerId: customer.id },
        select: { id: true },
      });
      if (!taxReturn) {
        res.status(404).json({ message: 'Tax return not found' });
        return;
      }
    }

    const document = await prisma.document.create({
      data: {
        ...input,
        customerId: customer.id,
        uploadedById: req.user!.id,
      },
    });
    res.status(201).json(document);
  }),
);

router.patch(
  '/:id/review',
  authorize('AUDITOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        status: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED']),
        remarks: z.string().trim().max(1000).optional(),
      })
      .parse(req.body);
    const document = await prisma.document.findUnique({
      where: { id: String(req.params.id) },
      include: { taxReturn: { select: { auditorId: true } } },
    });
    if (!document) {
      res.status(404).json({ message: 'Document not found' });
      return;
    }

    if (req.user!.role === 'AUDITOR') {
      const auditor = await prisma.auditor.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      if (!auditor || document.taxReturn?.auditorId !== auditor.id) {
        res.status(403).json({ message: 'Document is not assigned to you' });
        return;
      }
    }

    const updated = await prisma.document.update({
      where: { id: document.id },
      data: input,
    });
    res.json(updated);
  }),
);

export default router;
