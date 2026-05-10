/**
 * Structured fact payload for billing lifecycle notification templates.
 * All billing lifecycle templates (trial_ending, trial_expired, renewal_failed,
 * grace_ending, grace_expired, payment_recovered) consume this shape.
 * ADR-088 §3 — template strategy is required for transactional; payload must be deterministic.
 */
export type BillingLifecycleFactPayload = {
  /** Notification rule code, e.g. "trial_ending" */
  rule: string;
  workspaceId: string;
  planCode: string | null;
  planDisplayName: string;
  /** ISO string — trial end date or next period end (context-specific) */
  periodEndsAt: string | null;
  /** ISO string — grace period end date, for renewal_failed / grace_ending / grace_expired */
  graceEndsAt: string | null;
  /** ISO string — trial end date, for trial_ending / trial_expired */
  trialEndsAt: string | null;
  /** Payment amount in major currency units (e.g. 990 for ₽990), null if not available */
  amount: number | null;
  currency: string | null;
  /** Optional official provider/cash-register receipt URL for the completed payment. */
  officialReceiptUrl: string | null;
  /** Resolved locale for this notification. Defaults to "ru" when absent. */
  locale: string;
  /** Recipient email address — read by EmailChannelAdapter for the To field */
  recipientEmail: string | null;
};

/** Type guard for BillingLifecycleFactPayload extracted from an opaque factPayload record. */
export function isBillingLifecycleFactPayload(v: unknown): v is BillingLifecycleFactPayload {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["workspaceId"] === "string" &&
    typeof r["planDisplayName"] === "string" &&
    typeof r["rule"] === "string"
  );
}
