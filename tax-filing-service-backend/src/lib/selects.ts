import { Prisma } from '@prisma/client';

/** Public user fields safe to embed in other resources. */
export const userSummary = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

/** `userSummary` plus contact details, for a user's own profile views. */
export const userContact = {
  ...userSummary,
  phone: true,
} satisfies Prisma.UserSelect;
