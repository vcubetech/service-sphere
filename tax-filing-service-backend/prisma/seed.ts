import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Demo@12345';

/**
 * Idempotent insert for tables without a natural unique key: returns the
 * existing row if `find` matches, otherwise creates it. Safe to re-run.
 */
async function createIfMissing<T>(
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<T> {
  return (await find()) ?? create();
}

function upsertUser(name: string, email: string, role: Role, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, role, passwordHash },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const [admin, customerUser, auditorUser] = await Promise.all([
    upsertUser('Demo Admin', 'admin@demo.com', 'ADMIN', passwordHash),
    upsertUser('Demo Customer', 'customer@demo.com', 'CUSTOMER', passwordHash),
    upsertUser('Demo Auditor', 'auditor@demo.com', 'AUDITOR', passwordHash),
  ]);

  const [customer, auditor, financialYear] = await Promise.all([
    prisma.customer.upsert({
      where: { userId: customerUser.id },
      update: {},
      create: {
        userId: customerUser.id,
        panNumber: 'ABCDE1234F',
        dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
        fatherName: 'Demo Parent',
        address: '123 Demo Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        taxpayerType: 'INDIVIDUAL',
      },
    }),
    prisma.auditor.upsert({
      where: { userId: auditorUser.id },
      update: {},
      create: {
        userId: auditorUser.id,
        membershipNumber: 'DEMO-CA-001',
        firmName: 'Demo Tax Partners',
        qualification: 'Chartered Accountant',
        experienceYears: 5,
        status: 'VERIFIED',
        city: 'Bengaluru',
        isAvailable: true,
      },
    }),
    prisma.financialYear.upsert({
      where: { financialYear: '2025-26' },
      update: {},
      create: {
        financialYear: '2025-26',
        assessmentYear: '2026-27',
        startDate: new Date('2025-04-01T00:00:00.000Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z'),
        filingDueDate: new Date('2026-07-31T23:59:59.999Z'),
        isActive: true,
      },
    }),
  ]);

  const taxReturn = await prisma.taxReturn.upsert({
    where: { returnNumber: 'DEMO-ITR-2026-0001' },
    update: {},
    create: {
      returnNumber: 'DEMO-ITR-2026-0001',
      customerId: customer.id,
      auditorId: auditor.id,
      financialYearId: financialYear.id,
      itrForm: 'ITR_1',
      filingType: 'ORIGINAL',
      taxRegime: 'OLD_REGIME',
      status: 'UNDER_REVIEW',
      totalIncome: 1200000,
      totalDeductions: 150000,
      taxableIncome: 1050000,
      taxAmount: 65000,
      taxPaid: 70000,
      refundAmount: 5000,
    },
  });
  const taxReturnId = taxReturn.id;

  const filingEvents = [
    {
      previousStatus: null,
      currentStatus: 'DRAFT' as const,
      remarks: 'Demo tax return created.',
      changedBy: admin.id,
      changedAt: new Date('2026-04-25T09:00:00.000Z'),
    },
    {
      previousStatus: 'DRAFT' as const,
      currentStatus: 'UNDER_REVIEW' as const,
      remarks: 'Demo tax return submitted for review.',
      changedBy: customerUser.id,
      changedAt: new Date('2026-04-28T09:00:00.000Z'),
    },
  ];

  // Everything below depends only on the tax return, so it runs in parallel.
  await Promise.all([
    createIfMissing(
      () =>
        prisma.incomeDetail.findFirst({
          where: { taxReturnId, incomeType: 'SALARY', description: 'Demo salary income' },
        }),
      () =>
        prisma.incomeDetail.create({
          data: {
            taxReturnId,
            incomeType: 'SALARY',
            description: 'Demo salary income',
            employerName: 'Demo Technologies',
            grossAmount: 1200000,
            taxableAmount: 1200000,
            tdsAmount: 70000,
          },
        }),
    ),
    createIfMissing(
      () => prisma.deduction.findFirst({ where: { taxReturnId, section: '80C' } }),
      () =>
        prisma.deduction.create({
          data: {
            taxReturnId,
            section: '80C',
            description: 'Demo eligible investments',
            amount: 150000,
            eligibleAmount: 150000,
          },
        }),
    ),
    prisma.taxComputation.upsert({
      where: { taxReturnId },
      update: {},
      create: {
        taxReturnId,
        grossTotalIncome: 1200000,
        deductions: 150000,
        taxableIncome: 1050000,
        basicTax: 67000,
        cess: 2680,
        rebate: 4680,
        tds: 70000,
        finalTax: 65000,
      },
    }),
    createIfMissing(
      () =>
        prisma.document.findFirst({
          where: { customerId: customer.id, taxReturnId, fileName: 'demo-form-16.pdf' },
        }),
      () =>
        prisma.document.create({
          data: {
            customerId: customer.id,
            taxReturnId,
            uploadedById: customerUser.id,
            documentType: 'FORM_16',
            fileName: 'demo-form-16.pdf',
            fileUrl: 'https://example.com/demo-form-16.pdf',
            fileSize: 1024,
            mimeType: 'application/pdf',
            status: 'UNDER_REVIEW',
          },
        }),
    ),
    ...filingEvents.map((event) =>
      createIfMissing(
        () =>
          prisma.filingHistory.findFirst({
            where: { taxReturnId, currentStatus: event.currentStatus, remarks: event.remarks },
          }),
        () => prisma.filingHistory.create({ data: { taxReturnId, ...event } }),
      ),
    ),
    prisma.payment.upsert({
      where: { reference: 'DEMO-PAYMENT-2026-0001' },
      update: {},
      create: {
        taxReturnId,
        userId: customerUser.id,
        amount: 1499,
        status: 'PAID',
        method: 'UPI',
        provider: 'DEMO',
        reference: 'DEMO-PAYMENT-2026-0001',
      },
    }),
    seedAudit(taxReturnId, auditor.id),
  ]);

  console.log({
    admin: admin.email,
    customer: customerUser.email,
    auditor: auditorUser.email,
    password: DEMO_PASSWORD,
  });
}

/** The demo return's audit assignment with one finding and a draft report. */
async function seedAudit(taxReturnId: string, auditorId: string) {
  const assignment = await prisma.auditAssignment.upsert({
    where: { taxReturnId },
    update: {},
    create: {
      taxReturnId,
      auditorId,
      status: 'IN_PROGRESS',
      startedAt: new Date('2026-05-01T09:00:00.000Z'),
    },
  });
  const assignmentId = assignment.id;

  await Promise.all([
    createIfMissing(
      () =>
        prisma.auditFinding.findFirst({
          where: { assignmentId, title: 'Verify investment deductions' },
        }),
      () =>
        prisma.auditFinding.create({
          data: {
            assignmentId,
            title: 'Verify investment deductions',
            description: 'Confirm supporting documents for the claimed Section 80C amount.',
            severity: 'LOW',
            recommendation: 'Review the uploaded investment proof before approval.',
          },
        }),
    ),
    prisma.auditReport.upsert({
      where: { assignmentId },
      update: {},
      create: {
        assignmentId,
        reportNumber: 'DEMO-AUDIT-2026-0001',
        remarks: 'Demo audit report; pending final review.',
      },
    }),
  ]);
}

main()
  .catch((error: unknown) => {
    console.error('Prisma seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
