import { Router } from 'express';
import { randomUUID } from 'node:crypto';
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
    if (req.user!.role !== 'ADMIN') {
      where = { userId: req.user!.id };
    }
    const payments = await prisma.payment.findMany({
      where,
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
    const input = z
      .object({
        taxReturnId: z.string().min(1),
        amount: z.number().positive().max(10000000),
        method: z
          .enum(['UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'OTHER'])
          .optional(),
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
    const taxReturn = await prisma.taxReturn.findFirst({
      where: { id: input.taxReturnId, customerId: customer.id },
      select: { id: true },
    });
    if (!taxReturn) {
      res.status(404).json({ message: 'Tax return not found' });
      return;
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
    const input = z
      .object({
        status: z.enum(['PAID', 'FAILED', 'REFUNDED']),
      })
      .parse(req.body);
    const payment = await prisma.payment.update({
      where: { id: String(req.params.id) },
      data: { status: input.status },
    });
    res.json(payment);
  }),
);

export default router;
