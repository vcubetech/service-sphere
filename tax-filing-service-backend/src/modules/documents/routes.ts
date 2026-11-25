import { Router } from 'express';
import { DocumentType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import {
  assertAssignedAuditor,
  assignedAuditorUserId,
  requireCustomerId,
} from '../../lib/profiles';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';
import { AuthUser } from '../../types';

const router = Router();

router.use(authenticate);

const createDocumentSchema = z.object({
  taxReturnId: z.string().min(1).optional(),
  documentType: z.nativeEnum(DocumentType),
  fileName: z.string().trim().min(1).max(255),
  fileUrl: z.string().url().max(2048),
  fileSize: z.number().int().positive().optional(),
  mimeType: z.string().trim().max(100).optional(),
});

const reviewSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED']),
  remarks: z.string().trim().max(1000).optional(),
});

/** Customers see their own documents, auditors those of assigned returns. */
function documentScope(user: AuthUser): Prisma.DocumentWhereInput {
  switch (user.role) {
    case 'ADMIN':
      return {};
    case 'CUSTOMER':
      return { customer: { is: { userId: user.id } } };
    case 'AUDITOR':
      return { taxReturn: { is: { auditor: { is: { userId: user.id } } } } };
  }
}

/**
 * Resolves the customer a new document belongs to. When attached to a tax
 * return, the return must belong to the caller.
 */
async function resolveOwningCustomerId(
  userId: string,
  taxReturnId: string | undefined,
): Promise<string> {
  if (!taxReturnId) {
    return requireCustomerId(userId);
  }
  const taxReturn = await prisma.taxReturn.findFirst({
    where: { id: taxReturnId, customer: { is: { userId } } },
    select: { customerId: true },
  });
  if (!taxReturn) {
    throw HttpError.notFound('Tax return not found');
  }
  return taxReturn.customerId;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const documents = await prisma.document.findMany({
      where: documentScope(req.user!),
      orderBy: { createdAt: 'desc' },
    });
    res.json(documents);
  }),
);

router.post(
  '/',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = createDocumentSchema.parse(req.body);
    const customerId = await resolveOwningCustomerId(
      req.user!.id,
      input.taxReturnId,
    );

    const document = await prisma.document.create({
      data: { ...input, customerId, uploadedById: req.user!.id },
    });
    res.status(201).json(document);
  }),
);

router.patch(
  '/:id/review',
  authorize('AUDITOR', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const input = reviewSchema.parse(req.body);
    const document = await prisma.document.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, taxReturn: { select: assignedAuditorUserId } },
    });
    if (!document) {
      throw HttpError.notFound('Document not found');
    }
    assertAssignedAuditor(
      req.user!,
      document.taxReturn?.auditor?.userId,
      'Document is not assigned to you',
    );

    const updated = await prisma.document.update({
      where: { id: document.id },
      data: input,
    });
    res.json(updated);
  }),
);

export default router;
