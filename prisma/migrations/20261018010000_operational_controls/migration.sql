-- Old receipts get their original creation time + 24h, never a renewed permission.
ALTER TABLE "Execution" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);
ALTER TABLE "Approval" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);
UPDATE "Execution" SET "expiresAt" = "createdAt" + interval '24 hours';
UPDATE "Approval" a SET "expiresAt" = e."expiresAt" FROM "Execution" e WHERE e.id = a."executionId";
ALTER TABLE "Execution" ALTER COLUMN "expiresAt" SET NOT NULL, ALTER COLUMN "expiresAt" SET DEFAULT (CURRENT_TIMESTAMP + interval '24 hours');
ALTER TABLE "Approval" ALTER COLUMN "expiresAt" SET NOT NULL, ALTER COLUMN "expiresAt" SET DEFAULT (CURRENT_TIMESTAMP + interval '24 hours');
ALTER TABLE "Execution" ADD COLUMN "policyHashVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PolicyStudy" ADD COLUMN "policyHashVersion" INTEGER NOT NULL DEFAULT 1;

CREATE FUNCTION "guard_execution_deadline"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."policyHashVersion" IS DISTINCT FROM OLD."policyHashVersion" THEN
    RAISE EXCEPTION 'Execution deadline and hash version are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'RECEIVED' AND NEW.status = 'EXECUTING' AND OLD."expiresAt" <= clock_timestamp() THEN
    RAISE EXCEPTION 'Execution expired before first dispatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Execution_deadline_guard" BEFORE UPDATE ON "Execution" FOR EACH ROW EXECUTE FUNCTION "guard_execution_deadline"();

CREATE FUNCTION "guard_approval_deadline"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deadline TIMESTAMPTZ(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "expiresAt" INTO deadline FROM "Execution" WHERE id = NEW."executionId" AND "organizationId" = NEW."organizationId";
    IF FOUND THEN NEW."expiresAt" := deadline; END IF;
  ELSE
    IF NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
      RAISE EXCEPTION 'Approval deadline is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'PENDING' AND NEW.status <> 'PENDING' AND OLD."expiresAt" <= clock_timestamp() THEN
      RAISE EXCEPTION 'Approval expired' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Approval_deadline_guard" BEFORE INSERT OR UPDATE ON "Approval" FOR EACH ROW EXECUTE FUNCTION "guard_approval_deadline"();

CREATE TABLE "RequestRateWindow" (
  key VARCHAR(180) PRIMARY KEY, "windowStart" TIMESTAMPTZ(3) NOT NULL, count INTEGER NOT NULL CHECK(count > 0)
);
CREATE TABLE "SecurityAuditEvent" (
  id UUID PRIMARY KEY, "organizationId" UUID NOT NULL, "actorUserId" UUID NOT NULL,
  "targetId" UUID NOT NULL, event VARCHAR(64) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SecurityAuditEvent_organizationId_createdAt_id_idx" ON "SecurityAuditEvent"("organizationId", "createdAt", id);
-- Events deliberately retain IDs when test tenants/accounts are removed; no secret payloads.
CREATE FUNCTION "guard_security_audit_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Security audit events are immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER "SecurityAuditEvent_immutable" BEFORE UPDATE ON "SecurityAuditEvent" FOR EACH ROW EXECUTE FUNCTION "guard_security_audit_update"();
