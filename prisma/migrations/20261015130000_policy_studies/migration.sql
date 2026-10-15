CREATE TYPE "PolicyStudyMode" AS ENUM ('OBSERVE', 'SIMULATE');
CREATE TABLE "PolicyStudy" (
  id UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT,
  "agentId" UUID,
  "userId" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
  mode "PolicyStudyMode" NOT NULL,
  "policyHash" VARCHAR(64) NOT NULL,
  summary JSONB NOT NULL,
  results JSONB NOT NULL CHECK (jsonb_typeof(results)='array' AND jsonb_array_length(results) BETWEEN 1 AND 100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  FOREIGN KEY ("organizationId", "agentId") REFERENCES "Agent"("organizationId", id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((mode='OBSERVE' AND "agentId" IS NOT NULL AND "userId" IS NULL) OR (mode='SIMULATE' AND "userId" IS NOT NULL AND "agentId" IS NULL)),
  CHECK ("expiresAt">"createdAt" AND "expiresAt" <= "createdAt" + interval '30 days')
);
CREATE INDEX "PolicyStudy_organizationId_createdAt_id_idx" ON "PolicyStudy"("organizationId", "createdAt", id);
CREATE INDEX "PolicyStudy_expiresAt_idx" ON "PolicyStudy"("expiresAt");
CREATE FUNCTION freeze_policy_study() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Policy study evidence is immutable'; END $$;
CREATE TRIGGER policy_study_immutable BEFORE UPDATE ON "PolicyStudy" FOR EACH ROW EXECUTE FUNCTION freeze_policy_study();
