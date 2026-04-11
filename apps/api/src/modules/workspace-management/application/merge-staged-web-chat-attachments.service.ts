import { Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const STAGING_MAX_AGE_MS = 5 * 60 * 1000;

function isStagingUserMessageContent(content: string): boolean {
  const t = content.trim();
  if (t.length === 0) return true;
  return /^\(attached:\s*.+\)\s*$/i.test(t);
}

/**
 * Web chat stages each uploaded file as a separate user message with empty or
 * "(attached: …)" content. The turn `prepare` step then creates the real user
 * message with the transcript. This service moves attachments from those
 * staging rows onto the new message and deletes the empty staging rows so
 * history shows a single bubble (audio + hidden transcript for the model).
 */
@Injectable()
export class MergeStagedWebChatAttachmentsService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async mergeIntoUserMessage(params: {
    chatId: string;
    assistantId: string;
    userMessageId: string;
    userMessageCreatedAt: Date;
  }): Promise<void> {
    const { chatId, assistantId, userMessageId, userMessageCreatedAt } = params;

    const prior = await this.prisma.assistantChatMessage.findMany({
      where: {
        chatId,
        assistantId,
        createdAt: { lt: userMessageCreatedAt }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { attachments: true }
    });

    const stagingMessageIds: string[] = [];
    for (let i = prior.length - 1; i >= 0; i--) {
      const m = prior[i]!;
      if (m.author !== "user") break;
      if (!isStagingUserMessageContent(m.content)) break;
      const ageMs = userMessageCreatedAt.getTime() - m.createdAt.getTime();
      if (ageMs > STAGING_MAX_AGE_MS) break;
      stagingMessageIds.push(m.id);
      if (m.attachments.length === 0) {
        continue;
      }
    }

    if (stagingMessageIds.length === 0) return;

    stagingMessageIds.reverse();

    await this.prisma.$transaction([
      this.prisma.assistantChatMessageAttachment.updateMany({
        where: { messageId: { in: stagingMessageIds }, chatId },
        data: { messageId: userMessageId }
      }),
      this.prisma.assistantChatMessage.deleteMany({
        where: { id: { in: stagingMessageIds }, chatId, assistantId }
      })
    ]);
  }
}
