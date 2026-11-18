/*
  Warnings:

  - The values [PARTNER] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `bookingId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the `Booking` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Category` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Partner` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Review` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Service` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WalletTransaction` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[reference]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `taxReturnId` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AuditorStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TaxpayerType" AS ENUM ('INDIVIDUAL', 'HUF', 'FIRM', 'LLP', 'COMPANY', 'TRUST', 'AOP', 'BOI');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD_REGIME', 'NEW_REGIME');

-- CreateEnum
CREATE TYPE "ITRForm" AS ENUM ('ITR_1', 'ITR_2', 'ITR_3', 'ITR_4', 'ITR_5', 'ITR_6', 'ITR_7');

-- CreateEnum
CREATE TYPE "TaxReturnStatus" AS ENUM ('DRAFT', 'DOCUMENT_PENDING', 'UNDER_REVIEW', 'QUERY_RAISED', 'APPROVED', 'READY_TO_FILE', 'FILED', 'VERIFIED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'QUERY_RAISED', 'APPROVED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PAN_CARD', 'AADHAAR_CARD', 'FORM_16', 'BANK_STATEMENT', 'SALARY_SLIP', 'FORM_26AS', 'AIS', 'TIS', 'INVESTMENT_PROOF', 'BUSINESS_PROOF', 'BALANCE_SHEET', 'PROFIT_LOSS', 'AUDIT_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "FilingType" AS ENUM ('ORIGINAL', 'REVISED', 'BELATED', 'UPDATED');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('SALARY', 'HOUSE_PROPERTY', 'BUSINESS', 'CAPITAL_GAINS', 'OTHER_SOURCES');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('CUSTOMER', 'AUDITOR', 'ADMIN');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';
COMMIT;

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "Partner" DROP CONSTRAINT "Partner_userId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Service" DROP CONSTRAINT "Service_categoryId_fkey";

-- DropIndex
DROP INDEX "Payment_bookingId_key";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "bookingId",
ADD COLUMN     "method" "PaymentMethod",
ADD COLUMN     "taxReturnId" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "provider" DROP NOT NULL,
ALTER COLUMN "provider" DROP DEFAULT;

-- DropTable
DROP TABLE "Booking";

-- DropTable
DROP TABLE "Category";

-- DropTable
DROP TABLE "Partner";

-- DropTable
DROP TABLE "Review";

-- DropTable
DROP TABLE "Service";

-- DropTable
DROP TABLE "WalletTransaction";

-- DropEnum
DROP TYPE "BookingStatus";

-- DropEnum
DROP TYPE "PartnerStatus";

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "panNumber" TEXT NOT NULL,
    "aadhaarNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "taxpayerType" "TaxpayerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "fatherName" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "businessName" TEXT,
    "gstNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipNumber" TEXT,
    "firmName" TEXT,
    "qualification" TEXT,
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "status" "AuditorStatus" NOT NULL DEFAULT 'PENDING',
    "city" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auditor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "assessmentYear" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "filingDueDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReturn" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "auditorId" TEXT,
    "financialYearId" TEXT NOT NULL,
    "itrForm" "ITRForm",
    "filingType" "FilingType" NOT NULL DEFAULT 'ORIGINAL',
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'NEW_REGIME',
    "status" "TaxReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "totalIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxableIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "acknowledgementNumber" TEXT,
    "filedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeDetail" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "incomeType" "IncomeType" NOT NULL,
    "description" TEXT,
    "employerName" TEXT,
    "grossAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tdsAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "eligibleAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxComputation" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "grossTotalIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "exemptIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxableIncome" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "basicTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "rebate" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tds" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "advanceTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "selfAssessmentTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "finalTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxComputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "taxReturnId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditAssignment" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL DEFAULT 'MEDIUM',
    "recommendation" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditReport" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "reportUrl" TEXT,
    "remarks" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingHistory" (
    "id" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,
    "previousStatus" "TaxReturnStatus",
    "currentStatus" "TaxReturnStatus" NOT NULL,
    "remarks" TEXT,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_panNumber_key" ON "Customer"("panNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Auditor_userId_key" ON "Auditor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Auditor_membershipNumber_key" ON "Auditor"("membershipNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_financialYear_key" ON "FinancialYear"("financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_assessmentYear_key" ON "FinancialYear"("assessmentYear");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReturn_returnNumber_key" ON "TaxReturn"("returnNumber");

-- CreateIndex
CREATE INDEX "TaxReturn_customerId_financialYearId_idx" ON "TaxReturn"("customerId", "financialYearId");

-- CreateIndex
CREATE INDEX "TaxReturn_auditorId_status_idx" ON "TaxReturn"("auditorId", "status");

-- CreateIndex
CREATE INDEX "TaxReturn_status_idx" ON "TaxReturn"("status");

-- CreateIndex
CREATE INDEX "IncomeDetail_taxReturnId_incomeType_idx" ON "IncomeDetail"("taxReturnId", "incomeType");

-- CreateIndex
CREATE INDEX "Deduction_taxReturnId_section_idx" ON "Deduction"("taxReturnId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "TaxComputation_taxReturnId_key" ON "TaxComputation"("taxReturnId");

-- CreateIndex
CREATE INDEX "Document_customerId_documentType_idx" ON "Document"("customerId", "documentType");

-- CreateIndex
CREATE INDEX "Document_taxReturnId_idx" ON "Document"("taxReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditAssignment_taxReturnId_key" ON "AuditAssignment"("taxReturnId");

-- CreateIndex
CREATE INDEX "AuditFinding_assignmentId_isResolved_idx" ON "AuditFinding"("assignmentId", "isResolved");

-- CreateIndex
CREATE UNIQUE INDEX "AuditReport_assignmentId_key" ON "AuditReport"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditReport_reportNumber_key" ON "AuditReport"("reportNumber");

-- CreateIndex
CREATE INDEX "FilingHistory_taxReturnId_changedAt_idx" ON "FilingHistory"("taxReturnId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_taxReturnId_status_idx" ON "Payment"("taxReturnId", "status");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditor" ADD CONSTRAINT "Auditor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReturn" ADD CONSTRAINT "TaxReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReturn" ADD CONSTRAINT "TaxReturn_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "Auditor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReturn" ADD CONSTRAINT "TaxReturn_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeDetail" ADD CONSTRAINT "IncomeDetail_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxComputation" ADD CONSTRAINT "TaxComputation_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditAssignment" ADD CONSTRAINT "AuditAssignment_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditAssignment" ADD CONSTRAINT "AuditAssignment_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "Auditor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AuditAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AuditAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingHistory" ADD CONSTRAINT "FilingHistory_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_taxReturnId_fkey" FOREIGN KEY ("taxReturnId") REFERENCES "TaxReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
