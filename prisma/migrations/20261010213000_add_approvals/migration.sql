-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Approval" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Approval_executionId_key" ON "Approval"("executionId");

-- CreateIndex
CREATE INDEX "Approval_organizationId_status_createdAt_idx" ON "Approval"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_decidedByUserId_idx" ON "Approval"("decidedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_organizationId_executionId_key" ON "Approval"("organizationId", "executionId");

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_organizationId_executionId_fkey" FOREIGN KEY ("organizationId", "executionId") REFERENCES "Execution"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
