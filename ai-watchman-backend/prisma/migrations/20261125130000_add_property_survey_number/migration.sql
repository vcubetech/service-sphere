-- AlterTable
ALTER TABLE "Property" ADD COLUMN "surveyNumber" TEXT;

-- CreateIndex
-- NULLs are distinct in Postgres unique indexes, so existing properties without a survey number are unaffected.
CREATE UNIQUE INDEX "Property_ownerId_surveyNumber_key" ON "Property"("ownerId", "surveyNumber");
