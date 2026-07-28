import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import {
  DeliverChatAttachmentOnceService,
  attachmentMatchesDeliveryIdentity
} from "../src/modules/workspace-management/application/deliver-chat-attachment-once.service";

const SESSION_ROOT = "/workspace/assistants/assistant-1/sessions/runtime-session-1";
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";

type StoredAttachment = {
  id: string;
  storagePath: string | null;
  metadata: Record<string, unknown> | null;
};

function createPrismaDouble(input: {
  messageExists?: boolean;
  initialAttachments?: StoredAttachment[];
}) {
  const attachments: StoredAttachment[] = [...(input.initialAttachments ?? [])];
  let createCalls = 0;

  const tx = {
    $queryRaw: async () => (input.messageExists === false ? [] : [{ id: MESSAGE_ID }]),
    assistantChatMessageAttachment: {
      findMany: async () => attachments.map((row) => ({ ...row })),
      create: async (args: {
        data: {
          storagePath: string;
          metadata: Record<string, unknown>;
        };
        select: { id: true; storagePath: true; metadata: true };
      }) => {
        createCalls += 1;
        const created: StoredAttachment = {
          id: `attachment-${String(createCalls)}`,
          storagePath: args.data.storagePath,
          metadata: args.data.metadata
        };
        attachments.push(created);
        return created;
      }
    }
  };

  return {
    createCalls: () => createCalls,
    attachments: () => attachments,
    prisma: {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx)
    }
  };
}

function baseMediaInput(overrides: Record<string, unknown> = {}) {
  return {
    messageId: MESSAGE_ID,
    chatId: "chat-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    attachmentType: "image" as const,
    storagePath: `${SESSION_ROOT}/blue.png`,
    originalFilename: "blue.png",
    mimeType: "image/png",
    sizeBytes: BigInt(64),
    metadata: { kind: "image_generate" },
    deliveryIdentity: {
      kind: "media" as const,
      artifactId: "artifact-1",
      workspaceArtifactPath: `${SESSION_ROOT}/blue.png`
    },
    ...overrides
  };
}

describe("deliver-chat-attachment-once.service", () => {
  test("creates once and returns alreadyDelivered for the same media identity", async () => {
    const double = createPrismaDouble({});
    const service = new DeliverChatAttachmentOnceService(double.prisma as never);

    const first = await service.execute(baseMediaInput());
    const second = await service.execute(
      baseMediaInput({
        storagePath: `${SESSION_ROOT}/renamed-blue.png`,
        originalFilename: "renamed-blue.png",
        metadata: { kind: "files.attach" },
        deliveryIdentity: {
          kind: "media",
          workspaceArtifactPath: `${SESSION_ROOT}/blue.png`
        }
      })
    );

    assert.equal(first.alreadyDelivered, false);
    assert.equal(second.alreadyDelivered, true);
    assert.equal(second.attachment.id, first.attachment.id);
    assert.equal(double.createCalls(), 1);
  });

  test("matches legacy rows by storage path when deliveryIdentity stamp is absent", async () => {
    const path = `${SESSION_ROOT}/legacy.png`;
    const double = createPrismaDouble({
      initialAttachments: [
        {
          id: "legacy-1",
          storagePath: path,
          metadata: { kind: "image_generate" }
        }
      ]
    });
    const service = new DeliverChatAttachmentOnceService(double.prisma as never);

    const outcome = await service.execute(
      baseMediaInput({
        storagePath: path,
        deliveryIdentity: {
          kind: "media",
          workspaceArtifactPath: path
        }
      })
    );

    assert.equal(outcome.alreadyDelivered, true);
    assert.equal(outcome.attachment.id, "legacy-1");
    assert.equal(double.createCalls(), 0);
  });

  test("same document version is a duplicate; new version is deliverable", async () => {
    const double = createPrismaDouble({});
    const service = new DeliverChatAttachmentOnceService(double.prisma as never);
    const path = `${SESSION_ROOT}/report.pdf`;

    const first = await service.execute(
      baseMediaInput({
        attachmentType: "document",
        storagePath: path,
        originalFilename: "report.pdf",
        mimeType: "application/pdf",
        metadata: { kind: "document" },
        deliveryIdentity: {
          kind: "document",
          docId: "doc-1",
          versionId: "version-1",
          versionNumber: 1
        }
      })
    );
    const duplicateVersion = await service.execute(
      baseMediaInput({
        attachmentType: "document",
        storagePath: path,
        originalFilename: "report.pdf",
        mimeType: "application/pdf",
        metadata: { kind: "files.attach" },
        deliveryIdentity: {
          kind: "document",
          docId: "doc-1",
          versionId: "version-1",
          versionNumber: 1
        }
      })
    );
    const nextVersion = await service.execute(
      baseMediaInput({
        attachmentType: "document",
        storagePath: path,
        originalFilename: "report.pdf",
        mimeType: "application/pdf",
        metadata: { kind: "files.attach" },
        deliveryIdentity: {
          kind: "document",
          docId: "doc-1",
          versionId: "version-2",
          versionNumber: 2
        }
      })
    );

    assert.equal(first.alreadyDelivered, false);
    assert.equal(duplicateVersion.alreadyDelivered, true);
    assert.equal(nextVersion.alreadyDelivered, false);
    assert.equal(double.createCalls(), 2);
  });

  test("fails closed when the assistant message row is missing", async () => {
    const double = createPrismaDouble({ messageExists: false });
    const service = new DeliverChatAttachmentOnceService(double.prisma as never);

    await assert.rejects(
      () => service.execute(baseMediaInput()),
      (error: unknown) => error instanceof NotFoundException
    );
  });

  test("attachmentMatchesDeliveryIdentity covers renamed storagePath via aliases", () => {
    const canonical = `${SESSION_ROOT}/blue.png`;
    const renamed = `${SESSION_ROOT}/renamed-blue.png`;
    assert.equal(
      attachmentMatchesDeliveryIdentity(
        {
          storagePath: renamed,
          metadata: {
            deliveryIdentity: {
              canonicalKey: "media:artifact:artifact-1",
              aliases: ["media:artifact:artifact-1", `media:workspace:${canonical}`]
            }
          }
        },
        {
          kind: "media",
          artifactId: "artifact-1",
          workspaceArtifactPath: canonical
        }
      ),
      true
    );
    assert.equal(
      attachmentMatchesDeliveryIdentity(
        {
          storagePath: renamed,
          metadata: {
            deliveryIdentity: {
              canonicalKey: "media:artifact:artifact-1",
              aliases: ["media:artifact:artifact-1", `media:workspace:${canonical}`]
            }
          }
        },
        {
          kind: "media",
          workspaceArtifactPath: `${SESSION_ROOT}/other.png`
        }
      ),
      false
    );
  });
});
