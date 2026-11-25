import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate);

const createPaymentSchema = z.object({
  taxReturnId: z.string().min(1),
  amount: z.number().positive().max(10_000_000),
  method: z.nativeEnum(PaymentMethod).optional(),
});

const paymentStatusSchema = z.object({
  status: z.enum(['PAID', 'FAILED', 'REFUNDED']),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const payments = await prisma.payment.findMany({
      where: req.user!.role === 'ADMIN' ? {} : { userId: req.user!.id },
      include: {
        taxReturn: {
          select: {
            id: true,
            returnNumber: true,
            financialYear: { select: { financialYear: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(payments);
  }),
);

router.post(
  '/',
  authorize('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const input = createPaymentSchema.parse(req.body);
    const taxReturn = await prisma.taxReturn.findFirst({
      where: { id: input.taxReturnId, customer: { is: { userId: req.user!.id } } },
      select: { id: true },
    });
    if (!taxReturn) {
      throw HttpError.notFound('Tax return not found');
    }

    const payment = await prisma.payment.create({
      data: {
        taxReturnId: taxReturn.id,
        userId: req.user!.id,
        amount: input.amount,
        method: input.method,
        status: 'PENDING',
        provider: 'MANUAL',
        reference: `PAY-${randomUUID().slice(0, 12).toUpperCase()}`,
      },
    });
    res.status(201).json({
      payment,
      message: 'Payment recorded as pending; no payment gateway is connected.',
    });
  }),
);

router.patch(
  '/:id/status',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { status } = paymentStatusSchema.parse(req.body);
    const payment = await prisma.payment.update({
      where: { id: String(req.params.id) },
      data: { status },
    });
    res.json(payment);
  }),
);

export default router;
