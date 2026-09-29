/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,id]` on the table `Agent` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "keyPrefix" VARCHAR(64) NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_keyPrefix_key" ON "AgentCredential"("keyPrefix");

-- CreateIndex
CREATE INDEX "AgentCredential_organizationId_agentId_idx" ON "AgentCredential"("organizationId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_organizationId_id_key" ON "Agent"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "Agent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
