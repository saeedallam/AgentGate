ALTER TABLE "Execution" ADD COLUMN "recoveryVersion" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3), ADD COLUMN "nextRetryAt" TIMESTAMPTZ(3);
ALTER TABLE "ExecutionAttempt" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "resolvedAt" TIMESTAMPTZ(3), ADD COLUMN "resolvedStatus" "ExecutionStatus";
UPDATE "Execution" e SET "attemptCount" = 1 WHERE EXISTS
 (SELECT 1 FROM "ExecutionAttempt" a WHERE a."executionId" = e."id");
DROP INDEX "ExecutionAttempt_executionId_key";
CREATE UNIQUE INDEX "ExecutionAttempt_executionId_attemptNumber_key" ON "ExecutionAttempt"("executionId", "attemptNumber");
CREATE UNIQUE INDEX "ExecutionAttempt_one_active" ON "ExecutionAttempt"("executionId") WHERE "status" = 'EXECUTING';
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_recovery_bounds" CHECK ("recoveryVersion" IN (0,1) AND "attemptCount" BETWEEN 0 AND 3);
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_number" CHECK ("attemptNumber" BETWEEN 1 AND 3);
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_resolution" CHECK (
 ("resolvedAt" IS NULL AND "resolvedStatus" IS NULL) OR
 ("status" = 'OUTCOME_UNKNOWN' AND "resolvedAt" IS NOT NULL AND "resolvedStatus" IN ('SUCCEEDED','FAILED')));
CREATE TABLE "FakeProviderReceipt" (
 "executionId" UUID PRIMARY KEY, "organizationId" UUID NOT NULL, "requestHash" VARCHAR(64) NOT NULL,
 "outcome" JSONB, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("organizationId", "executionId") REFERENCES "Execution"("organizationId", "id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE FUNCTION "guard_recovery_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."recoveryVersion" IS DISTINCT FROM OLD."recoveryVersion" THEN
  RAISE EXCEPTION 'Recovery contract is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "Execution_recovery_version" BEFORE UPDATE ON "Execution" FOR EACH ROW EXECUTE FUNCTION "guard_recovery_version"();
CREATE FUNCTION "guard_fake_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."executionId",NEW."organizationId",NEW."requestHash",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD."executionId",OLD."organizationId",OLD."requestHash",OLD."createdAt")
    OR (OLD."outcome" IS NOT NULL AND NEW."outcome" IS DISTINCT FROM OLD."outcome") THEN
  RAISE EXCEPTION 'Provider receipt is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "FakeProviderReceipt_immutable" BEFORE UPDATE ON "FakeProviderReceipt" FOR EACH ROW EXECUTE FUNCTION "guard_fake_receipt"();

CREATE UNIQUE INDEX "FakeProviderReceipt_organizationId_executionId_key" ON "FakeProviderReceipt"("organizationId","executionId");

CREATE FUNCTION "guard_attempt_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."id",NEW."organizationId",NEW."executionId",NEW."credentialId",NEW."attemptNumber",NEW."startedAt")
 IS DISTINCT FROM ROW(OLD."id",OLD."organizationId",OLD."executionId",OLD."credentialId",OLD."attemptNumber",OLD."startedAt") THEN
  RAISE EXCEPTION 'Attempt identity is immutable' USING ERRCODE = '23514';
 END IF;
 IF OLD."status" <> 'EXECUTING' AND ROW(NEW."status",NEW."finishedAt",NEW."errorCode")
 IS DISTINCT FROM ROW(OLD."status",OLD."finishedAt",OLD."errorCode") THEN
  RAISE EXCEPTION 'Attempt observation is final' USING ERRCODE = '23514';
 END IF;
 IF OLD."resolvedAt" IS NOT NULL AND ROW(NEW."resolvedAt",NEW."resolvedStatus")
 IS DISTINCT FROM ROW(OLD."resolvedAt",OLD."resolvedStatus") THEN
  RAISE EXCEPTION 'Attempt resolution is final' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ExecutionAttempt_identity" BEFORE UPDATE ON "ExecutionAttempt" FOR EACH ROW EXECUTE FUNCTION "guard_attempt_identity"();

CREATE FUNCTION "guard_fake_receipt_binding"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Execution" WHERE "id" = NEW."executionId"
 AND "organizationId" = NEW."organizationId" AND "requestHash" = NEW."requestHash") THEN
  RAISE EXCEPTION 'Provider receipt must bind stored request' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "FakeProviderReceipt_binding" BEFORE INSERT ON "FakeProviderReceipt" FOR EACH ROW EXECUTE FUNCTION "guard_fake_receipt_binding"();
