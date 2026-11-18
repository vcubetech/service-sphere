import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';

export async function visibleReturnWhere(
  userId: string,
  role: Role,
  returnId: string,
) {
  if (role === 'ADMIN') {
    return { id: returnId };
  }
  if (role === 'CUSTOMER') {
    const customer = await prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });
    return customer ? { id: returnId, customerId: customer.id } : null;
  }
  const auditor = await prisma.auditor.findUnique({
    where: { userId },
    select: { id: true },
  });
  return auditor
    ? { id: returnId, auditorId: auditor.id }
    : null;
}

export async function editableCustomerReturn(
  userId: string,
  returnId: string,
) {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!customer) {
    return null;
  }

  const taxReturn = await prisma.taxReturn.findFirst({
    where: { id: returnId, customerId: customer.id },
    select: { id: true, status: true },
  });
  if (
    !taxReturn ||
    (taxReturn.status !== 'DRAFT' && taxReturn.status !== 'QUERY_RAISED')
  ) {
    return null;
  }
  return { customer, taxReturn };
}
