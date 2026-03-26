-- H3: Add persona traits, avatar, and user profile fields

-- AppUser: birthday and gender for user context
ALTER TABLE "app_users" ADD COLUMN "birthday" DATE,
ADD COLUMN "gender" VARCHAR(32);

-- Assistant: draft persona fields
ALTER TABLE "assistants" ADD COLUMN "draft_traits" JSONB,
ADD COLUMN "draft_avatar_emoji" VARCHAR(8),
ADD COLUMN "draft_avatar_url" TEXT;

-- AssistantPublishedVersion: snapshot persona fields
ALTER TABLE "assistant_published_versions" ADD COLUMN "snapshot_traits" JSONB,
ADD COLUMN "snapshot_avatar_emoji" VARCHAR(8),
ADD COLUMN "snapshot_avatar_url" TEXT;
