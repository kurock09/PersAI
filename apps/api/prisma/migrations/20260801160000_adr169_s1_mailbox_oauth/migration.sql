-- ADR-169 S1: connect the workspace's own mailbox over OAuth instead of
-- verifying a sender address through Postmark. Additive only — the ADR-168
-- address-confirmation columns and statuses are dropped in S5.
CREATE TYPE "WorkspaceEmailMailboxProvider" AS ENUM ('mailru', 'yandex');

-- Mailbox connection state is its own enum rather than extra values on
-- "WorkspaceEmailSenderIdentityStatus": the ADR-168 address contract has no
-- honest representation for a connected mailbox, and S5 drops it wholesale.
CREATE TYPE "WorkspaceEmailMailboxStatus" AS ENUM ('connected', 'token_invalid');

ALTER TABLE "workspace_email_sender_identities"
  ADD COLUMN "provider" "WorkspaceEmailMailboxProvider",
  ADD COLUMN "mailbox_status" "WorkspaceEmailMailboxStatus",
  ADD COLUMN "token_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "connected_at" TIMESTAMPTZ(6);

-- The provider redirect carries no Clerk session, so this single-use row is
-- the only guard on it. Only the SHA-256 digest of the state is stored.
CREATE TABLE "workspace_email_oauth_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "provider" "WorkspaceEmailMailboxProvider" NOT NULL,
  "state_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_email_oauth_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_email_oauth_states_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_email_oauth_states_state_hash_key"
  ON "workspace_email_oauth_states"("state_hash");

CREATE INDEX "workspace_email_oauth_states_expires_at_idx"
  ON "workspace_email_oauth_states"("expires_at");
