import assert from "node:assert/strict";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { WorkspaceVideoClonedVoicesController } from "../src/modules/workspace-management/interface/http/workspace-video-cloned-voices.controller";

async function run(): Promise<void> {
  const controller = new WorkspaceVideoClonedVoicesController(
    {
      async createClonedVoice(input: {
        workspaceId: string;
        displayName: string;
        languageHint: string | null;
        removeBackgroundNoise: boolean;
      }) {
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.displayName, "Narrator");
        assert.equal(input.languageHint, "en");
        assert.equal(input.removeBackgroundNoise, true);
        return {
          clonedVoice: {
            id: "clone-1",
            displayName: "Narrator",
            status: "ready",
            languageHint: "en",
            isDefault: false,
            previewAudioUrl: null,
            createdAt: "2026-06-07T15:30:00.000Z"
          },
          walletBalanceVc: 80
        };
      },
      async listClonedVoices() {
        return {
          clonedVoices: [
            {
              id: "clone-1",
              displayName: "Narrator",
              status: "ready",
              languageHint: "en",
              isDefault: false,
              previewAudioUrl: null,
              createdAt: "2026-06-07T15:30:00.000Z"
            }
          ],
          limit: 5,
          creationVcoinCost: 50
        };
      },
      async archiveClonedVoice(input: { clonedVoiceId: string }) {
        assert.equal(input.clonedVoiceId, "clone-1");
        return { archived: true as const, clonedVoiceId: "clone-1" };
      },
      async setDefaultClonedVoice(input: { clonedVoiceId: string }) {
        assert.equal(input.clonedVoiceId, "clone-1");
        return {
          clonedVoice: {
            id: "clone-1",
            displayName: "Narrator",
            status: "ready" as const,
            languageHint: "en",
            isDefault: true,
            previewAudioUrl: null,
            createdAt: "2026-06-07T15:30:00.000Z"
          }
        };
      }
    } as never,
    {
      async resolveMembership(userId: string) {
        assert.equal(userId, "user-1");
        return {
          workspaceId: "workspace-1",
          workspaceMemberId: "member-1",
          activeAssistantId: null
        };
      }
    } as never
  );

  const req = {
    requestId: "req-1",
    workspaceId: null,
    resolvedAppUser: { id: "user-1" }
  } as never;

  const created = await controller.createClonedVoice(
    req,
    "workspace-1",
    {
      displayName: "Narrator",
      languageHint: "en",
      removeBackgroundNoise: "true"
    },
    {
      buffer: Buffer.from([0x49, 0x44, 0x33, 0x03]),
      mimetype: "audio/mpeg",
      originalname: "voice.mp3"
    }
  );
  assert.equal(created.clonedVoice.id, "clone-1");
  assert.equal(created.walletBalanceVc, 80);

  const listed = await controller.listClonedVoices(req, "workspace-1");
  assert.equal(listed.clonedVoices.length, 1);

  const archived = await controller.archiveClonedVoice(req, "workspace-1", "clone-1");
  assert.equal(archived.archived, true);

  const defaulted = await controller.setDefaultClonedVoice(req, "workspace-1", "clone-1");
  assert.equal(defaulted.clonedVoice.isDefault, true);

  await assert.rejects(
    () => controller.listClonedVoices(req, "workspace-2"),
    (error: unknown) =>
      error instanceof UnauthorizedException &&
      error.message.includes("requested workspace does not match")
  );

  await assert.rejects(
    () =>
      controller.createClonedVoice(
        req,
        "workspace-1",
        { displayName: "Narrator", removeBackgroundNoise: "maybe" },
        {
          buffer: Buffer.from([0x49, 0x44, 0x33, 0x03]),
          mimetype: "audio/mpeg",
          originalname: "voice.mp3"
        }
      ),
    (error: unknown) => error instanceof BadRequestException
  );

  console.log("workspace-video-cloned-voices.controller: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
