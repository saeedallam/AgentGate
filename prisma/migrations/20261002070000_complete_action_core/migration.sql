-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "idempotencyKey" VARCHAR(128),
ADD COLUMN     "requestHash" VARCHAR(64);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'EXECUTING',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "errorCode" VARCHAR(100),

    CONSTRAINT "ExecutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FakePayment" (
    "organizationId" UUID NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "refundExecutionId" UUID,

    CONSTRAINT "FakePayment_pkey" PRIMARY KEY ("organizationId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_executionId_key" ON "ExecutionAttempt"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "FakePayment_refundExecutionId_key" ON "FakePayment"("refundExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_organizationId_agentId_idempotencyKey_key" ON "Execution"("organizationId", "agentId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_organizationId_id_key" ON "Execution"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_organizationId_executionId_fkey" FOREIGN KEY ("organizationId", "executionId") REFERENCES "Execution"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FakePayment" ADD CONSTRAINT "FakePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

