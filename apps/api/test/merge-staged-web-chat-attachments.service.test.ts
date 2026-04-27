import assert from "node:assert/strict";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import { MergeStagedWebChatAttachmentsService } from "../src/modules/workspace-management/application/merge-staged-web-chat-attachments.service";

class FakeWorkspaceManagementPrismaService {
  priorMessages: Array<{
    id: string;
    author: "user" | "assistant" | "system";
    content: string;
    createdAt: Date;
    attachments: Array<{ id: string }>;
  }> = [];
  stagedAttachments: Array<{ messageId: string }> = [];
  updateManyArgs: Record<string, unknown> | null = null;
  deleteManyArgs: Record<string, unknown> | null = null;
  stagedFindManyArgs: Record<string, unknown> | null = null;

  assistantChatMessage = {
    findMany: async () => this.priorMessages,
    deleteMany: async (args: Record<string, unknown>) => {
      this.deleteManyArgs = args;
      return { count: 3 };
    }
  };

  assistantChatMessageAttachment = {
    findMany: async (args: Record<string, unknown>) => {
      this.stagedFindManyArgs = args;
      return this.stagedAttachments;
    },
    updateMany: async (args: Record<string, unknown>) => {
      this.updateManyArgs = args;
      return { count: 2 };
    }
  };

  async $transaction<T>(operations: Promise<T>[]): Promise<T[]> {
    return Promise.all(operations);
  }
}

async function run(): Promise<void> {
  const prisma = new FakeWorkspaceManagementPrismaService();
  const service = new MergeStagedWebChatAttachmentsService(
    prisma as unknown as WorkspaceManagementPrismaService
  );
  const userMessageCreatedAt = new Date("2026-04-11T12:00:00.000Z");

  prisma.priorMessages = [
    {
      id: "assistant-1",
      author: "assistant",
      content: "previous reply",
      createdAt: new Date("2026-04-11T11:57:00.000Z"),
      attachments: []
    },
    {
      id: "stage-1",
      author: "user",
      content: "(attached: image-1.png)",
      createdAt: new Date("2026-04-11T11:58:00.000Z"),
      attachments: [{ id: "attachment-1" }]
    },
    {
      id: "orphan-empty",
      author: "user",
      content: "",
      createdAt: new Date("2026-04-11T11:59:00.000Z"),
      attachments: []
    },
    {
      id: "stage-2",
      author: "user",
      content: "",
      createdAt: new Date("2026-04-11T11:59:30.000Z"),
      attachments: [{ id: "attachment-2" }]
    }
  ];

  await service.mergeIntoUserMessage({
    chatId: "chat-1",
    assistantId: "assistant-1",
    userMessageId: "user-message",
    userMessageCreatedAt
  });

  assert.deepEqual(prisma.updateManyArgs, {
    where: {
      messageId: {
        in: ["stage-1", "orphan-empty", "stage-2"]
      },
      chatId: "chat-1"
    },
    data: {
      messageId: "user-message"
    }
  });
  assert.deepEqual(prisma.deleteManyArgs, {
    where: {
      id: {
        in: ["stage-1", "orphan-empty", "stage-2"]
      },
      chatId: "chat-1",
      assistantId: "assistant-1"
    }
  });

  const explicitPrisma = new FakeWorkspaceManagementPrismaService();
  explicitPrisma.stagedAttachments = [
    { messageId: "stage-client-1" },
    { messageId: "stage-client-1" }
  ];
  const explicitService = new MergeStagedWebChatAttachmentsService(
    explicitPrisma as unknown as WorkspaceManagementPrismaService
  );

  await explicitService.mergeIntoUserMessage({
    chatId: "chat-1",
    assistantId: "assistant-1",
    userMessageId: "user-message",
    userMessageCreatedAt,
    clientTurnId: "turn-1"
  });

  assert.deepEqual(explicitPrisma.stagedFindManyArgs, {
    where: {
      chatId: "chat-1",
      assistantId: "assistant-1",
      clientTurnId: "turn-1"
    },
    select: { messageId: true }
  });
  assert.deepEqual(explicitPrisma.updateManyArgs, {
    where: {
      messageId: {
        in: ["stage-client-1"]
      },
      chatId: "chat-1",
      clientTurnId: "turn-1"
    },
    data: {
      messageId: "user-message"
    }
  });
}

void run();
