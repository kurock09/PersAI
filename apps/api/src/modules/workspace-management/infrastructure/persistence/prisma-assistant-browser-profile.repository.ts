import { Injectable } from "@nestjs/common";
import { Prisma, type AssistantBrowserProfile as PrismaRow } from "@prisma/client";
import type {
  AssistantBrowserProfileStatus,
  LocalBrowserBridgeDeviceKind
} from "@persai/runtime-contract";
import type {
  AssistantBrowserProfileRepository,
  AssistantBrowserProfileRow,
  CreateAssistantBrowserProfileInput
} from "../../domain/assistant-browser-profile.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantBrowserProfileRepository implements AssistantBrowserProfileRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findByAssistantAndKey(
    assistantId: string,
    profileKey: string
  ): Promise<AssistantBrowserProfileRow | null> {
    const row = await this.prisma.assistantBrowserProfile.findUnique({
      where: {
        assistantId_profileKey: {
          assistantId,
          profileKey
        }
      }
    });
    return row ? this.mapToDomain(row) : null;
  }

  async findById(id: string): Promise<AssistantBrowserProfileRow | null> {
    const row = await this.prisma.assistantBrowserProfile.findUnique({ where: { id } });
    return row ? this.mapToDomain(row) : null;
  }

  async listByAssistant(assistantId: string): Promise<AssistantBrowserProfileRow[]> {
    const rows = await this.prisma.assistantBrowserProfile.findMany({
      where: { assistantId },
      orderBy: [{ createdAt: "desc" }]
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async listProfileKeysWithPrefix(assistantId: string, prefix: string): Promise<string[]> {
    const rows = await this.prisma.assistantBrowserProfile.findMany({
      where: {
        assistantId,
        profileKey: { startsWith: prefix }
      },
      select: { profileKey: true }
    });
    return rows.map((row) => row.profileKey);
  }

  async findMostRecentPendingLogin(
    assistantId: string
  ): Promise<AssistantBrowserProfileRow | null> {
    const row = await this.prisma.assistantBrowserProfile.findFirst({
      where: {
        assistantId,
        status: "pending_login"
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return row ? this.mapToDomain(row) : null;
  }

  async findMostRecentPendingLoginForChat(
    assistantId: string,
    chatId: string
  ): Promise<AssistantBrowserProfileRow | null> {
    const row = await this.prisma.assistantBrowserProfile.findFirst({
      where: {
        assistantId,
        originatingChatId: chatId,
        status: "pending_login"
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return row ? this.mapToDomain(row) : null;
  }

  async findReusableByAssistantAndOriginHost(
    assistantId: string,
    originHost: string,
    originatingChatId?: string | null
  ): Promise<AssistantBrowserProfileRow | null> {
    const active = await this.prisma.assistantBrowserProfile.findFirst({
      where: {
        assistantId,
        originHost,
        status: "active"
      },
      orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }]
    });
    if (active !== null) {
      return this.mapToDomain(active);
    }
    if (typeof originatingChatId === "string" && originatingChatId.trim().length > 0) {
      const pendingForChat = await this.prisma.assistantBrowserProfile.findFirst({
        where: {
          assistantId,
          originHost,
          originatingChatId: originatingChatId.trim(),
          status: "pending_login"
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
      });
      if (pendingForChat !== null) {
        return this.mapToDomain(pendingForChat);
      }
    }
    const pending = await this.prisma.assistantBrowserProfile.findFirst({
      where: {
        assistantId,
        originHost,
        status: "pending_login"
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return pending ? this.mapToDomain(pending) : null;
  }

  async create(input: CreateAssistantBrowserProfileInput): Promise<AssistantBrowserProfileRow> {
    const row = await this.prisma.assistantBrowserProfile.create({
      data: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        profileKey: input.profileKey,
        displayName: input.displayName,
        loginUrl: input.loginUrl,
        originHost: input.originHost,
        bridgeSessionRef: input.bridgeSessionRef ?? null,
        bridgeClientKind: input.bridgeClientKind ?? null,
        originatingChatId: input.originatingChatId ?? null,
        status: input.status
      }
    });
    return this.mapToDomain(row);
  }

  async updateStatus(id: string, status: AssistantBrowserProfileStatus): Promise<void> {
    await this.prisma.assistantBrowserProfile.update({
      where: { id },
      data: { status }
    });
  }

  async updatePendingLogin(
    id: string,
    input: {
      bridgeSessionRef: string | null;
      bridgeClientKind: LocalBrowserBridgeDeviceKind;
    }
  ): Promise<void> {
    await this.prisma.assistantBrowserProfile.update({
      where: { id },
      data: {
        bridgeSessionRef: input.bridgeSessionRef,
        bridgeClientKind: input.bridgeClientKind,
        status: "pending_login"
      }
    });
  }

  async activate(
    id: string,
    input: {
      bridgeSessionRef: string;
      bridgeClientKind: LocalBrowserBridgeDeviceKind;
      lastUsedAt: Date;
      expiresAt: Date;
    }
  ): Promise<void> {
    await this.prisma.assistantBrowserProfile.update({
      where: { id },
      data: {
        status: "active",
        bridgeSessionRef: input.bridgeSessionRef,
        bridgeClientKind: input.bridgeClientKind,
        lastUsedAt: input.lastUsedAt,
        expiresAt: input.expiresAt
      }
    });
  }

  async updateBridgeSessionRef(id: string, bridgeSessionRef: string | null): Promise<void> {
    await this.prisma.assistantBrowserProfile.update({
      where: { id },
      data: { bridgeSessionRef }
    });
  }

  async touch(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void> {
    await this.prisma.assistantBrowserProfile.update({
      where: { id },
      data: { lastUsedAt, expiresAt }
    });
  }

  async markExpired(id: string): Promise<void> {
    await this.prisma.assistantBrowserProfile.update({
      where: { id },
      data: { status: "expired", bridgeSessionRef: null }
    });
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.assistantBrowserProfile.deleteMany({ where: { id } });
    return result.count > 0;
  }

  async claimExpiredProfiles(limit: number): Promise<AssistantBrowserProfileRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          workspaceId: string;
          profileKey: string;
          displayName: string;
          loginUrl: string;
          originHost: string;
          bridgeSessionRef: string | null;
          bridgeClientKind: LocalBrowserBridgeDeviceKind | null;
          originatingChatId: string | null;
          status: AssistantBrowserProfileStatus;
          lastUsedAt: Date | null;
          expiresAt: Date | null;
          createdAt: Date;
          updatedAt: Date;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id" AS "assistantId",
          "workspace_id" AS "workspaceId",
          "profile_key" AS "profileKey",
          "display_name" AS "displayName",
          "login_url" AS "loginUrl",
          "origin_host" AS "originHost",
          "bridge_session_ref" AS "bridgeSessionRef",
          "bridge_client_kind" AS "bridgeClientKind",
          "originating_chat_id" AS "originatingChatId",
          "status",
          "last_used_at" AS "lastUsedAt",
          "expires_at" AS "expiresAt",
          "created_at" AS "createdAt",
          "updated_at" AS "updatedAt"
        FROM "assistant_browser_profiles"
        WHERE "status" = 'active'
          AND "expires_at" IS NOT NULL
          AND "expires_at" < NOW()
        ORDER BY "expires_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      await tx.assistantBrowserProfile.updateMany({
        where: { id: { in: ids } },
        data: { status: "expired", bridgeSessionRef: null }
      });
      return rows.map((row) => ({
        ...row,
        status: "expired" as const
      }));
    });
  }

  private mapToDomain(row: PrismaRow): AssistantBrowserProfileRow {
    return {
      id: row.id,
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      profileKey: row.profileKey,
      displayName: row.displayName,
      loginUrl: row.loginUrl,
      originHost: row.originHost,
      bridgeSessionRef: row.bridgeSessionRef,
      bridgeClientKind:
        row.bridgeClientKind === "extension" || row.bridgeClientKind === "capacitor"
          ? row.bridgeClientKind
          : null,
      originatingChatId: row.originatingChatId,
      status: row.status,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
