-- CreateTable
CREATE TABLE "assistant_governance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "capability_envelope" JSONB,
    "secret_refs" JSONB,
    "policy_envelope" JSONB,
    "quota_plan_code" TEXT,
    "quota_hook" JSONB,
    "audit_hook" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assistant_governance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_governance_assistant_id_key" ON "assistant_governance"("assistant_id");

-- AddForeignKey
ALTER TABLE "assistant_governance" ADD CONSTRAINT "assistant_governance_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
