-- A pending approval has no human decision evidence; final decisions require both.
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decision_metadata" CHECK (
  ("status" = 'PENDING' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL)
  OR ("status" IN ('APPROVED', 'REJECTED') AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL)
);

CREATE FUNCTION "guard_approval_binding"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked "Execution"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'Approval must start pending' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO linked FROM "Execution"
      WHERE "id" = NEW."executionId" AND "organizationId" = NEW."organizationId";
    -- Missing/foreign references are rejected by the existing composite foreign key.
    IF FOUND THEN
      IF linked."status" <> 'RECEIVED'
        OR linked."policyDecision" IS DISTINCT FROM 'REQUIRE_APPROVAL'::"PolicyDecision"
        OR linked."requestHash" IS DISTINCT FROM NEW."requestHash"
        OR linked."policyReason" IS NULL OR linked."policyHash" IS NULL
        OR linked."policyEvaluatedAt" IS NULL THEN
        RAISE EXCEPTION 'Approval must bind the original pending request' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    IF ROW(NEW."id", NEW."organizationId", NEW."executionId", NEW."requestHash", NEW."createdAt")
      IS DISTINCT FROM ROW(OLD."id", OLD."organizationId", OLD."executionId", OLD."requestHash", OLD."createdAt") THEN
      RAISE EXCEPTION 'Approval binding is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" <> 'PENDING' AND
      ROW(NEW."status", NEW."decidedByUserId", NEW."decidedAt")
      IS DISTINCT FROM ROW(OLD."status", OLD."decidedByUserId", OLD."decidedAt") THEN
      RAISE EXCEPTION 'Approval decision is final' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Approval_binding_guard"
BEFORE INSERT OR UPDATE ON "Approval"
FOR EACH ROW EXECUTE FUNCTION "guard_approval_binding"();
