-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('RECEIVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN');

-- CreateEnum
CREATE TYPE "ExecutionEnvironment" AS ENUM ('development', 'staging', 'production');

-- CreateTable
CREATE TABLE "Execution" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "actionName" VARCHAR(100) NOT NULL,
    "arguments" JSONB NOT NULL,
    "resourceType" VARCHAR(100),
    "resourceId" VARCHAR(256),
    "environment" "ExecutionEnvironment" NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'RECEIVED',
    "result" JSONB,
    "errorCode" VARCHAR(100),
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Execution_organizationId_agentId_createdAt_idx" ON "Execution"("organizationId", "agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "Agent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
