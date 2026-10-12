-- Preserve the original request and initial policy evidence for every receipt,
-- including legacy rows. Progress/result fields are deliberately not compared.
CREATE FUNCTION "guard_execution_request_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."organizationId", NEW."agentId", NEW."idempotencyKey",
    NEW."actionName", NEW."arguments", NEW."resourceType", NEW."resourceId",
    NEW."environment", NEW."requestHash", NEW."requestedAt", NEW."createdAt",
    NEW."policyDecision", NEW."policyReason", NEW."policyHash", NEW."policyEvaluatedAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."organizationId", OLD."agentId", OLD."idempotencyKey",
    OLD."actionName", OLD."arguments", OLD."resourceType", OLD."resourceId",
    OLD."environment", OLD."requestHash", OLD."requestedAt", OLD."createdAt",
    OLD."policyDecision", OLD."policyReason", OLD."policyHash", OLD."policyEvaluatedAt"
  ) THEN
    RAISE EXCEPTION 'Execution request evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Execution_request_immutable"
BEFORE UPDATE ON "Execution"
FOR EACH ROW EXECUTE FUNCTION "guard_execution_request_immutable"();
