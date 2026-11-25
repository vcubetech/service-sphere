import { prisma } from '../config/prisma';
import { AuthUser } from '../types';
import { HttpError } from './httpError';

/** Returns the customer profile id for a user, or throws 404. */
export async function requireCustomerId(userId: string): Promise<string> {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!customer) {
    throw HttpError.notFound('Customer profile not found');
  }
  return customer.id;
}

/**
 * Auditors may only act on records assigned to them; admins may act on any.
 * Pass the `userId` of the record's assigned auditor (load it with
 * `auditor: { select: { userId: true } }` in the same query as the record).
 */
export function assertAssignedAuditor(
  user: AuthUser,
  assignedAuditorUserId: string | null | undefined,
  message: string,
): void {
  if (user.role === 'AUDITOR' && assignedAuditorUserId !== user.id) {
    throw HttpError.forbidden(message);
  }
}

/** Prisma select that loads just the assigned auditor's user id. */
export const assignedAuditorUserId = {
  auditor: { select: { userId: true } },
} as const;
