-- ADR-168 S1: workspace-scoped verified sender identity for model-initiated
-- assistant email. One verified address per workspace in v1.
CREATE TYPE "WorkspaceEmailSenderIdentityStatus" AS ENUM ('pending', 'verified', 'failed');

CREATE TABLE "workspace_email_sender_identities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(120),
  "status" "WorkspaceEmailSenderIdentityStatus" NOT NULL DEFAULT 'pending',
  "postmark_signature_id" VARCHAR(64),
  "last_error_reason" VARCHAR(128),
  "requested_at" TIMESTAMPTZ(6) NOT NULL,
  "verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_email_sender_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_email_sender_identities_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_email_sender_identities_workspace_id_key"
  ON "workspace_email_sender_identities"("workspace_id");
