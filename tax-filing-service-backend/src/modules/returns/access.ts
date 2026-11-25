import { Prisma, TaxReturnStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AuthUser } from '../../types';

/** Statuses in which a customer may still change their return. */
const EDITABLE_STATUSES: TaxReturnStatus[] = ['DRAFT', 'QUERY_RAISED'];

/**
 * Filter limiting tax returns to those the user may see: admins see all,
 * customers their own, auditors the ones assigned to them. Resolved through
 * relation filters so callers need a single query.
 */
export function taxReturnScope(user: AuthUser): Prisma.TaxReturnWhereInput {
  switch (user.role) {
    case 'ADMIN':
      return {};
    case 'CUSTOMER':
      return { customer: { is: { userId: user.id } } };
    case 'AUDITOR':
      return { auditor: { is: { userId: user.id } } };
  }
}

/** The customer's own return, if it is still editable; otherwise null. */
export function findEditableCustomerReturn(userId: string, returnId: string) {
  return prisma.taxReturn.findFirst({
    where: {
      id: returnId,
      customer: { is: { userId } },
      status: { in: EDITABLE_STATUSES },
    },
    select: { id: true, status: true },
  });
}
