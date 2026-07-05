-- ADR-138 audit fix batch A — persist liveUrl on pending browser profiles.

ALTER TABLE "assistant_browser_profiles" ADD COLUMN "live_url" TEXT;
