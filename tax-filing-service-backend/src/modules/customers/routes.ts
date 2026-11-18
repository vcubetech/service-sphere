import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';

const router = Router();

router.use(authenticate, authorize('CUSTOMER'));

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { userId: req.user!.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
    if (!customer) {
      res.status(404).json({ message: 'Customer profile not found' });
      return;
    }
    res.json(customer);
  }),
);

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        aadhaarNumber: z
          .string()
          .trim()
          .regex(/^[0-9]{12}$/)
          .optional(),
        dateOfBirth: z.string().datetime().optional(),
        taxpayerType: z
          .enum(['INDIVIDUAL', 'HUF', 'FIRM', 'LLP', 'COMPANY', 'TRUST', 'AOP', 'BOI'])
          .optional(),
        fatherName: z.string().trim().max(150).nullable().optional(),
        address: z.string().trim().max(500).nullable().optional(),
        city: z.string().trim().max(100).nullable().optional(),
        state: z.string().trim().max(100).nullable().optional(),
        pincode: z.string().trim().max(20).nullable().optional(),
        businessName: z.string().trim().max(200).nullable().optional(),
        gstNumber: z.string().trim().max(20).nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'Provide at least one profile field to update',
      })
      .parse(req.body);

    const customer = await prisma.customer.update({
      where: { userId: req.user!.id },
      data: {
        ...input,
        dateOfBirth: input.dateOfBirth
          ? new Date(input.dateOfBirth)
          : undefined,
      },
    });
    res.json(customer);
  }),
);

export default router;
