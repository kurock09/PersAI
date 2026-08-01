-- ADR-169 S5: drop the ADR-168 Postmark sender-signature layer. The
-- mailbox OAuth columns added in the 20260801160000 migration (provider,
-- mailbox_status, token_expires_at, connected_at) are now the only
-- send-eligibility truth, so the address-confirmation columns/enum they
-- replaced are dead weight. email/display_name/last_error_reason are kept:
-- S1-S4 repurposed them as the connected mailbox's own address/display name
-- and its last connection error.
ALTER TABLE "workspace_email_sender_identities"
  DROP COLUMN "status",
  DROP COLUMN "postmark_signature_id",
  DROP COLUMN "requested_at",
  DROP COLUMN "verified_at";

DROP TYPE "WorkspaceEmailSenderIdentityStatus";
