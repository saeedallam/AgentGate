CREATE TYPE "RefundReservationStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED');
CREATE TABLE "RefundBudgetBucket" (
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "environment" "ExecutionEnvironment" NOT NULL,
  "currency" VARCHAR(3) NOT NULL CHECK ("currency" = 'USD'),
  "day" DATE NOT NULL,
  "limitMinor" INTEGER NOT NULL CHECK ("limitMinor" >= 0),
  "reservedMinor" INTEGER NOT NULL DEFAULT 0 CHECK ("reservedMinor" >= 0),
  "consumedMinor" INTEGER NOT NULL DEFAULT 0 CHECK ("consumedMinor" >= 0),
  PRIMARY KEY ("organizationId", "environment", "currency", "day"),
  CHECK ("reservedMinor"::bigint + "consumedMinor"::bigint <= "limitMinor")
);
CREATE TABLE "RefundBudgetReservation" (
  "executionId" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "environment" "ExecutionEnvironment" NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "day" DATE NOT NULL,
  "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" > 0),
  "status" "RefundReservationStatus" NOT NULL DEFAULT 'HELD',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMPTZ(3),
  FOREIGN KEY ("organizationId", "executionId") REFERENCES "Execution"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("organizationId", "environment", "currency", "day") REFERENCES "RefundBudgetBucket"("organizationId", "environment", "currency", "day") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("status" = 'HELD' AND "settledAt" IS NULL) OR ("status" <> 'HELD' AND "settledAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "RefundBudgetReservation_organizationId_executionId_key" ON "RefundBudgetReservation"("organizationId", "executionId");
CREATE INDEX "RefundBudgetReservation_scope_idx" ON "RefundBudgetReservation"("organizationId", "environment", "currency", "day");
CREATE FUNCTION protect_refund_budget_bucket() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId",NEW."environment",NEW."currency",NEW."day",NEW."limitMinor") IS DISTINCT FROM ROW(OLD."organizationId",OLD."environment",OLD."currency",OLD."day",OLD."limitMinor") THEN
    RAISE EXCEPTION 'Daily refund budget scope and limit are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_budget_bucket_immutable BEFORE UPDATE ON "RefundBudgetBucket" FOR EACH ROW EXECUTE FUNCTION protect_refund_budget_bucket();
CREATE FUNCTION protect_refund_budget_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'HELD' OR NOT EXISTS (
      SELECT 1 FROM "Execution" e WHERE e.id=NEW."executionId" AND e."organizationId"=NEW."organizationId"
        AND e.environment=NEW.environment AND e."actionName"='refund.create'
        AND e.arguments->>'currency'=NEW.currency AND (e.arguments->>'amountMinor')::numeric=NEW."amountMinor"
        AND e.status='EXECUTING'
    ) THEN RAISE EXCEPTION 'Refund reservation binding mismatch'; END IF;
  ELSE
    IF ROW(NEW."executionId",NEW."organizationId",NEW.environment,NEW.currency,NEW.day,NEW."amountMinor",NEW."createdAt") IS DISTINCT FROM ROW(OLD."executionId",OLD."organizationId",OLD.environment,OLD.currency,OLD.day,OLD."amountMinor",OLD."createdAt") THEN
      RAISE EXCEPTION 'Refund reservation binding is immutable';
    END IF;
    IF OLD.status <> 'HELD' AND ROW(NEW.status,NEW."settledAt") IS DISTINCT FROM ROW(OLD.status,OLD."settledAt") THEN
      RAISE EXCEPTION 'Refund settlement is final';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_budget_reservation_immutable BEFORE INSERT OR UPDATE ON "RefundBudgetReservation" FOR EACH ROW EXECUTE FUNCTION protect_refund_budget_reservation();
