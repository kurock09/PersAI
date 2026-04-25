import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildAssistantAvatarUrl,
  extractAvatarHashFromUrl,
  ManageAssistantAvatarService
} from "../src/modules/workspace-management/application/manage-assistant-avatar.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

  // ADR-076 follow-up (2026-04-25): server normalizes every avatar to JPEG
  // before hashing, so the URL extension is always `.jpg` and the hash is
  // taken from the normalized bytes (input to `buildAssistantAvatarUrl`).
  const normalized = Buffer.from("hello-normalized-jpeg-bytes");
  const expectedHash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);

  assert.equal(buildAssistantAvatarUrl(normalized), `/api/avatar/${expectedHash}.jpg`);

  assert.equal(extractAvatarHashFromUrl(null), null);
  assert.equal(extractAvatarHashFromUrl("https://legacy.example.com/avatar.png"), null);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedHash}.jpg`), expectedHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedHash}.png`), expectedHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedHash}`), expectedHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/zzzzz.png`), null);

  // Tall portraits must crop from the visual center. `sharp`'s attention crop
  // can bias upward on high-contrast photos, which made assistant avatars save
  // forehead/top-heavy instead of centered.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require("sharp") as typeof import("sharp");
  const tallPortrait = await sharp({
    create: {
      width: 100,
      height: 300,
      channels: 3,
      background: "#f87171"
    }
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: "#22c55e"
          }
        })
          .jpeg()
          .toBuffer(),
        top: 100,
        left: 0
      },
      {
        input: await sharp({
          create: {
            width: 100,
            height: 100,
            channels: 3,
            background: "#60a5fa"
          }
        })
          .jpeg()
          .toBuffer(),
        top: 200,
        left: 0
      }
    ])
    .jpeg()
    .toBuffer();

  let storedAvatar: Buffer | null = null;
  const service = new ManageAssistantAvatarService(
    {
      async findByUserId() {
        return {
          id: "assistant-1",
          draftDisplayName: "PersAI",
          draftInstructions: "Be helpful",
          draftAvatarUrl: null
        };
      },
      async updateDraft() {
        return {};
      }
    } as never,
    {
      buildAssistantPrefix() {
        return "assistant/assistant-1/";
      },
      async deletePrefix() {
        return undefined;
      },
      async saveObject(input: { buffer: Buffer }) {
        storedAvatar = input.buffer;
      }
    } as never
  );

  await service.upload({
    userId: "user-1",
    fileBuffer: tallPortrait,
    mimeType: "image/jpeg",
    originalFilename: "portrait.jpg"
  });

  assert.ok(storedAvatar, "avatar bytes should be persisted");
  const centerPixel = await sharp(storedAvatar).resize(1, 1).raw().toBuffer();
  assert.ok(centerPixel[1] > centerPixel[0], "center crop should preserve the middle green band");
}

void run();
