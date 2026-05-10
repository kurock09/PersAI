CREATE TYPE "WorkspaceSubscriptionRecurringMigrationStatus" AS ENUM (
  'idle',
  'in_progress',
  'succeeded',
  'failed'
);

ALTER TABLE "workspace_subscriptions"
  ADD COLUMN "last_payment_method_class" "WorkspacePaymentMethodClass",
  ADD COLUMN "auto_renew_method_class" "WorkspacePaymentMethodClass",
  ADD COLUMN "recurring_migration_status" "WorkspaceSubscriptionRecurringMigrationStatus" NOT NULL DEFAULT 'idle',
  ADD COLUMN "recurring_migration_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "recurring_migration_target_method_class" "WorkspacePaymentMethodClass",
  ADD COLUMN "recurring_migration_failure_reason" TEXT,
  ADD COLUMN "provider_recurring_descriptor" VARCHAR(512);
