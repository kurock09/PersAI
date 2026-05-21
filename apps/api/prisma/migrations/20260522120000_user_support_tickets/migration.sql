-- Add NotificationSource enum value in its own migration so it is committed
-- before user_support is referenced (PostgreSQL 55P04 safe-enum rule).

ALTER TYPE "NotificationSource" ADD VALUE IF NOT EXISTS 'user_support';
