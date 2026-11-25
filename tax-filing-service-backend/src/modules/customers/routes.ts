import { Router } from 'express';
import { TaxpayerType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../lib/httpError';
import { userContact } from '../../lib/selects';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

router.use(authenticate, authorize('CUSTOMER'));

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const updateProfileSchema = z
  .object({
    aadhaarNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{12}$/)
      .optional(),
    dateOfBirth: z.string().datetime().optional(),
    taxpayerType: z.nativeEnum(TaxpayerType).optional(),
    fatherName: optionalText(150),
    address: optionalText(500),
    city: optionalText(100),
    state: optionalText(100),
    pincode: optionalText(20),
    businessName: optionalText(200),
    gstNumber: optionalText(20),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one profile field to update',
  });

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { userId: req.user!.id },
      include: { user: { select: userContact } },
    });
    if (!customer) {
      throw HttpError.notFound('Customer profile not found');
    }
    res.json(customer);
  }),
);

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const { dateOfBirth, ...input } = updateProfileSchema.parse(req.body);

    const customer = await prisma.customer.update({
      where: { userId: req.user!.id },
      data: {
        ...input,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      },
    });
    res.json(customer);
  }),
);

export default router;
