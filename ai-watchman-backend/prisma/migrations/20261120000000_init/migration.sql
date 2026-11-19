CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OWNER', 'ANALYST');
CREATE TYPE "MonitoringStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "ChangeSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "AlertType" AS ENUM ('LAND_COVER_CHANGE', 'VEGETATION_LOSS', 'WATER_CHANGE', 'BUILT_UP_CHANGE', 'CUSTOM');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'OWNER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Property" (
  "id" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "areaHectares" DOUBLE PRECISION,
  "boundary" JSONB,
  "centroidLat" DOUBLE PRECISION,
  "centroidLng" DOUBLE PRECISION,
  "address" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MonitoringJob" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "requestedById" UUID,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "cloudMaxPercent" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "collection" TEXT NOT NULL DEFAULT 'COPERNICUS/S2_SR_HARMONIZED',
  "result" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonitoringJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LandChange" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "monitoringJobId" UUID,
  "changeType" TEXT NOT NULL,
  "severity" "ChangeSeverity" NOT NULL DEFAULT 'MEDIUM',
  "confidence" DOUBLE PRECISION,
  "areaHectares" DOUBLE PRECISION,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "beforeImageDate" TIMESTAMP(3),
  "afterImageDate" TIMESTAMP(3),
  "beforeImageUrl" TEXT,
  "afterImageUrl" TEXT,
  "geometry" JSONB,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandChange_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Alert" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "type" "AlertType" NOT NULL DEFAULT 'LAND_COVER_CHANGE',
  "severity" "ChangeSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MonitoringReport" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "summary" TEXT NOT NULL,
  "metrics" JSONB,
  "fileUrl" TEXT,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Property_ownerId_idx" ON "Property"("ownerId");
CREATE INDEX "MonitoringJob_propertyId_createdAt_idx" ON "MonitoringJob"("propertyId", "createdAt");
CREATE INDEX "LandChange_propertyId_detectedAt_idx" ON "LandChange"("propertyId", "detectedAt");
CREATE INDEX "Alert_propertyId_status_createdAt_idx" ON "Alert"("propertyId", "status", "createdAt");
CREATE INDEX "MonitoringReport_propertyId_generatedAt_idx" ON "MonitoringReport"("propertyId", "generatedAt");

ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringJob" ADD CONSTRAINT "MonitoringJob_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LandChange" ADD CONSTRAINT "LandChange_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringReport" ADD CONSTRAINT "MonitoringReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
