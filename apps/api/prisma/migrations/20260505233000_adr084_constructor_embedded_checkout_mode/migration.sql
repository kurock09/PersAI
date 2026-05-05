ALTER TYPE "WorkspacePaymentCheckoutMode" RENAME TO "WorkspacePaymentCheckoutMode_old";

CREATE TYPE "WorkspacePaymentCheckoutMode" AS ENUM (
  'embedded',
  'redirect',
  'payment_link',
  'qr_code',
  'manual_test'
);

ALTER TABLE "workspace_payment_intents"
ALTER COLUMN "checkout_mode" TYPE "WorkspacePaymentCheckoutMode"
USING (
  CASE
    WHEN "checkout_mode"::TEXT = 'widget' THEN 'embedded'
    ELSE "checkout_mode"::TEXT
  END
)::"WorkspacePaymentCheckoutMode";

DROP TYPE "WorkspacePaymentCheckoutMode_old";
