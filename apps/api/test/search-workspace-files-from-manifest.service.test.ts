import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SearchWorkspaceFilesFromManifestService } from "../src/modules/workspace-management/application/search-workspace-files-from-manifest.service";

describe("SearchWorkspaceFilesFromManifestService", () => {
  test("tokenized query matches shortDescription", async () => {
    const service = new SearchWorkspaceFilesFromManifestService({
      list: async () => [
        {
          path: "/workspace/assistants/a1/sessions/s1/IMG_4821.jpg",
          mimeType: "image/jpeg",
          sizeBytes: BigInt(1200),
          shortDescription: "Selfie on a nature trail, person wearing a hoodie and cap.",
          workspaceId: "ws-1",
          contentHash: null,
          originChatId: "chat-1",
          originAssistantId: "a1",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]
    } as never);
    const outcome = await service.execute({
      workspaceId: "ws-1",
      assistantId: "a1",
      sessionId: "s1",
      query: "photo cap"
    });
    assert.equal(outcome.items.length, 1);
    assert.match(outcome.items[0]?.path ?? "", /IMG_4821\.jpg/);
  });
});
