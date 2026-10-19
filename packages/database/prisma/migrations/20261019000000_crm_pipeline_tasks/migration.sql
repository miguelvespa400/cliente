-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "dealValue" DOUBLE PRECISION,
ADD COLUMN     "expectedCloseDate" TIMESTAMP(3),
ADD COLUMN     "ownerId" TEXT,
ALTER COLUMN "campaignId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "follow_ups" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'call';

-- CreateIndex
CREATE INDEX "leads_workspaceId_crmStatus_idx" ON "leads"("workspaceId", "crmStatus");

-- CreateIndex
CREATE INDEX "follow_ups_leadId_done_scheduledAt_idx" ON "follow_ups"("leadId", "done", "scheduledAt");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

