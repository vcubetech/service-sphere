import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const demoPassword = 'Demo@12345';

async function main() {
  const passwordHash = await bcrypt.hash(demoPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      name: 'Demo Admin',
      email: 'admin@demo.com',
      passwordHash,
      role: 'ADMIN',
    },
  });

  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@demo.com' },
    update: {},
    create: {
      name: 'Demo Customer',
      email: 'customer@demo.com',
      passwordHash,
      role: 'CUSTOMER',
    },
  });

  const auditorUser = await prisma.user.upsert({
    where: { email: 'auditor@demo.com' },
    update: {},
    create: {
      name: 'Demo Auditor',
      email: 'auditor@demo.com',
      passwordHash,
      role: 'AUDITOR',
    },
  });

  const customer = await prisma.customer.upsert({
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
  });

  const auditor = await prisma.auditor.upsert({
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
  });

  const financialYear = await prisma.financialYear.upsert({
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
  });

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

  const incomeDetail = await prisma.incomeDetail.findFirst({
    where: {
      taxReturnId: taxReturn.id,
      incomeType: 'SALARY',
      description: 'Demo salary income',
    },
  });

  if (!incomeDetail) {
    await prisma.incomeDetail.create({
      data: {
        taxReturnId: taxReturn.id,
        incomeType: 'SALARY',
        description: 'Demo salary income',
        employerName: 'Demo Technologies',
        grossAmount: 1200000,
        taxableAmount: 1200000,
        tdsAmount: 70000,
      },
    });
  }

  const deduction = await prisma.deduction.findFirst({
    where: { taxReturnId: taxReturn.id, section: '80C' },
  });

  if (!deduction) {
    await prisma.deduction.create({
      data: {
        taxReturnId: taxReturn.id,
        section: '80C',
        description: 'Demo eligible investments',
        amount: 150000,
        eligibleAmount: 150000,
      },
    });
  }

  await prisma.taxComputation.upsert({
    where: { taxReturnId: taxReturn.id },
    update: {},
    create: {
      taxReturnId: taxReturn.id,
      grossTotalIncome: 1200000,
      deductions: 150000,
      taxableIncome: 1050000,
      basicTax: 67000,
      cess: 2680,
      rebate: 4680,
      tds: 70000,
      finalTax: 65000,
    },
  });

  const assignment = await prisma.auditAssignment.upsert({
    where: { taxReturnId: taxReturn.id },
    update: {},
    create: {
      taxReturnId: taxReturn.id,
      auditorId: auditor.id,
      status: 'IN_PROGRESS',
      startedAt: new Date('2026-05-01T09:00:00.000Z'),
    },
  });

  const finding = await prisma.auditFinding.findFirst({
    where: {
      assignmentId: assignment.id,
      title: 'Verify investment deductions',
    },
  });

  if (!finding) {
    await prisma.auditFinding.create({
      data: {
        assignmentId: assignment.id,
        title: 'Verify investment deductions',
        description: 'Confirm supporting documents for the claimed Section 80C amount.',
        severity: 'LOW',
        recommendation: 'Review the uploaded investment proof before approval.',
      },
    });
  }

  const document = await prisma.document.findFirst({
    where: {
      customerId: customer.id,
      taxReturnId: taxReturn.id,
      fileName: 'demo-form-16.pdf',
    },
  });

  if (!document) {
    await prisma.document.create({
      data: {
        customerId: customer.id,
        taxReturnId: taxReturn.id,
        uploadedById: customerUser.id,
        documentType: 'FORM_16',
        fileName: 'demo-form-16.pdf',
        fileUrl: 'https://example.com/demo-form-16.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        status: 'UNDER_REVIEW',
      },
    });
  }

  await prisma.auditReport.upsert({
    where: { assignmentId: assignment.id },
    update: {},
    create: {
      assignmentId: assignment.id,
      reportNumber: 'DEMO-AUDIT-2026-0001',
      remarks: 'Demo audit report; pending final review.',
    },
  });

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

  for (const event of filingEvents) {
    const existingEvent = await prisma.filingHistory.findFirst({
      where: {
        taxReturnId: taxReturn.id,
        currentStatus: event.currentStatus,
        remarks: event.remarks,
      },
    });

    if (!existingEvent) {
      await prisma.filingHistory.create({
        data: { taxReturnId: taxReturn.id, ...event },
      });
    }
  }

  await prisma.payment.upsert({
    where: { reference: 'DEMO-PAYMENT-2026-0001' },
    update: {},
    create: {
      taxReturnId: taxReturn.id,
      userId: customerUser.id,
      amount: 1499,
      status: 'PAID',
      method: 'UPI',
      provider: 'DEMO',
      reference: 'DEMO-PAYMENT-2026-0001',
    },
  });

  console.log({
    admin: admin.email,
    customer: customerUser.email,
    auditor: auditorUser.email,
    password: demoPassword,
  });
}

main()
  .catch((error: unknown) => {
    console.error('Prisma seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
