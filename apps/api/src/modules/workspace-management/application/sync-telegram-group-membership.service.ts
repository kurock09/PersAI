import { Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export interface SyncTelegramGroupMembershipInput {
  assistantId: string;
  telegramChatId: string;
  title: string;
  event: "joined" | "left";
  memberCount?: number | null;
}

@Injectable()
export class SyncTelegramGroupMembershipService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async hasActiveGroup(input: { assistantId: string; telegramChatId: string }): Promise<boolean> {
    const group = await this.prisma.assistantTelegramGroup.findUnique({
      where: {
        assistantId_telegramChatId: {
          assistantId: input.assistantId,
          telegramChatId: input.telegramChatId
        }
      },
      select: { status: true }
    });
    return group?.status === "active";
  }

  async execute(input: SyncTelegramGroupMembershipInput): Promise<void> {
    if (input.event === "joined") {
      const existingGroup = await this.prisma.assistantTelegramGroup.findUnique({
        where: {
          assistantId_telegramChatId: {
            assistantId: input.assistantId,
            telegramChatId: input.telegramChatId
          }
        },
        select: { title: true }
      });

      const dedupeTitles = Array.from(
        new Set(
          [existingGroup?.title?.trim() ?? "", input.title]
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        )
      );

      if (dedupeTitles.length > 0) {
        await this.prisma.assistantTelegramGroup.updateMany({
          where: {
            assistantId: input.assistantId,
            title: { in: dedupeTitles },
            telegramChatId: { not: input.telegramChatId },
            status: "active"
          },
          data: { status: "left", leftAt: new Date() }
        });
      }

      await this.prisma.assistantTelegramGroup.upsert({
        where: {
          assistantId_telegramChatId: {
            assistantId: input.assistantId,
            telegramChatId: input.telegramChatId
          }
        },
        create: {
          assistantId: input.assistantId,
          telegramChatId: input.telegramChatId,
          title: input.title || "Unknown group",
          memberCount: input.memberCount ?? null,
          status: "active",
          joinedAt: new Date()
        },
        update: {
          ...(input.title ? { title: input.title } : {}),
          ...(input.memberCount !== undefined ? { memberCount: input.memberCount } : {}),
          status: "active",
          leftAt: null
        }
      });
      return;
    }

    await this.prisma.assistantTelegramGroup.updateMany({
      where: {
        assistantId: input.assistantId,
        telegramChatId: input.telegramChatId
      },
      data: { status: "left", leftAt: new Date() }
    });
  }
}
