ALTER TABLE "Execution"
  ADD COLUMN "blockedPolicyDecision" "PolicyDecision",
  ADD COLUMN "blockedPolicyHash" VARCHAR(64),
  ADD COLUMN "blockedAt" TIMESTAMPTZ(3);

ALTER TABLE "Execution" ADD CONSTRAINT "Execution_block_evidence" CHECK (
  ("status" = 'DENIED' AND "policyDecision" IS NOT DISTINCT FROM 'ALLOW'::"PolicyDecision"
    AND "errorCode" IS NOT DISTINCT FROM 'POLICY_TIGHTENED'
    AND "blockedPolicyDecision" IS NOT NULL AND "blockedPolicyDecision" IN ('DENY', 'REQUIRE_APPROVAL')
    AND "blockedPolicyHash" IS NOT NULL AND length("blockedPolicyHash") = 64
    AND "blockedAt" IS NOT NULL AND "result" IS NULL)
  OR ("status" <> 'DENIED' AND "blockedPolicyDecision" IS NULL
    AND "blockedPolicyHash" IS NULL AND "blockedAt" IS NULL)
);

CREATE FUNCTION "guard_execution_denial"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'DENIED' AND ROW(NEW."status", NEW."errorCode",
      NEW."blockedPolicyDecision", NEW."blockedPolicyHash", NEW."blockedAt")
    IS DISTINCT FROM ROW(OLD."status", OLD."errorCode",
      OLD."blockedPolicyDecision", OLD."blockedPolicyHash", OLD."blockedAt") THEN
    RAISE EXCEPTION 'Execution denial is final' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'DENIED' AND OLD."status" NOT IN ('RECEIVED', 'DENIED') THEN
    RAISE EXCEPTION 'Started execution cannot be denied retroactively' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Execution_denial_guard" BEFORE UPDATE ON "Execution"
FOR EACH ROW EXECUTE FUNCTION "guard_execution_denial"();
