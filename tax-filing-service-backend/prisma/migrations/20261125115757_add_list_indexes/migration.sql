-- CreateIndex
CREATE INDEX "AuditAssignment_auditorId_assignedAt_idx" ON "AuditAssignment"("auditorId", "assignedAt");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
