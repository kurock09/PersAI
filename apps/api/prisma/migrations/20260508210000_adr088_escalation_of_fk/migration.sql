-- ADR-088 Slice 1 closeout: add FK for escalation_of in notification_delivery_attempts
-- escalation_of → notification_delivery_attempts.id (ON DELETE SET NULL)

ALTER TABLE "notification_delivery_attempts"
  ADD CONSTRAINT "notification_delivery_attempts_escalation_of_fkey"
  FOREIGN KEY ("escalation_of")
  REFERENCES "notification_delivery_attempts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
