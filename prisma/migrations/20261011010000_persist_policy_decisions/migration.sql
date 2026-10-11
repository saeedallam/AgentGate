-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW', 'DENY', 'REQUIRE_APPROVAL');

-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "policyDecision" "PolicyDecision",
ADD COLUMN     "policyEvaluatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "policyHash" VARCHAR(64),
ADD COLUMN     "policyReason" VARCHAR(100);

-- Legacy rows keep all decision fields NULL; never invent historical permission.
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_policy_snapshot_complete" CHECK (
  ("policyDecision" IS NULL AND "policyReason" IS NULL AND "policyHash" IS NULL AND "policyEvaluatedAt" IS NULL)
  OR
  ("policyDecision" IS NOT NULL AND "policyReason" IS NOT NULL AND "policyHash" IS NOT NULL
   AND "policyEvaluatedAt" IS NOT NULL AND "requestHash" IS NOT NULL)
);
