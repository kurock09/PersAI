import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AssistantAbuseAssistantState as PrismaAssistantAbuseAssistantState,
  AssistantAbuseGuardState as PrismaAssistantAbuseGuardState
} from "@prisma/client";
import type {
  AbuseDecisionSnapshot,
  AssistantAbuseGuardRepository,
  RegisterDistributedAbuseAttemptInput,
  RegisterDistributedAbuseAttemptResult
} from "../../domain/assistant-abuse-guard.repository";
import type {
  AbuseSurface,
  AssistantAbuseAssistantState,
  AssistantAbuseGuardState,
  AssistantAbusePeerState
} from "../../domain/assistant-abuse-guard.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

function maxDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  const sa = a ?? null;
  const sb = b ?? null;
  if (sa === null) {
    return sb;
  }
  if (sb === null) {
    return sa;
  }
  return sa.getTime() >= sb.getTime() ? sa : sb;
}

function isQuotaPressureApplying(quotaDecision: AbuseDecisionSnapshot): boolean {
  return quotaDecision.blockedUntil != null || quotaDecision.slowedUntil != null;
}

function abuseDecisionAfterQuotaReconciled(
  persisted: {
    blockedUntil: Date | null;
    slowedUntil: Date | null;
    blockReason: string | null;
  } | null,
  quotaDecision: AbuseDecisionSnapshot
): AbuseDecisionSnapshot {
  if (persisted === null) {
    return { blockedUntil: null, slowedUntil: null, reason: null };
  }
  if (isQuotaPressureApplying(quotaDecision)) {
    return {
      blockedUntil: persisted.blockedUntil,
      slowedUntil: persisted.slowedUntil,
      reason: persisted.blockReason
    };
  }
  const reason = persisted.blockReason ?? "";
  if (reason === "quota_pressure_temporary_block" || reason === "quota_pressure_slowdown") {
    return { blockedUntil: null, slowedUntil: null, reason: null };
  }
  return {
    blockedUntil: persisted.blockedUntil,
    slowedUntil: persisted.slowedUntil,
    reason: persisted.blockReason
  };
}

@Injectable()
export class PrismaAssistantAbuseGuardRepository implements AssistantAbuseGuardRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findUserState(
    assistantId: string,
    userId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseGuardState | null> {
    const row = await this.prisma.assistantAbuseGuardState.findUnique({
      where: {
        assistantId_userId_surface: {
          assistantId,
          userId,
          surface
        }
      }
    });
    return row === null ? null : this.toUserDomain(row);
  }

  async findAssistantState(
    assistantId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseAssistantState | null> {
    const row = await this.prisma.assistantAbuseAssistantState.findUnique({
      where: {
        assistantId_surface: {
          assistantId,
          surface
        }
      }
    });
    return row === null ? null : this.toAssistantDomain(row);
  }

  async registerPeerAttempt(input: {
    assistantId: string;
    surface: AbuseSurface;
    peerKey: string;
    attemptedAt: Date;
    windowStartedAfter: Date;
  }): Promise<AssistantAbusePeerState> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "assistant_abuse_peer_states" (
        "assistant_id",
        "surface",
        "peer_key",
        "window_started_at",
        "request_count",
        "last_seen_at"
      )
      VALUES (
        ${input.assistantId}::uuid,
        ${input.surface}::"abuse_surface",
        ${input.peerKey},
        ${input.attemptedAt},
        1,
        ${input.attemptedAt}
      )
      ON CONFLICT ("assistant_id", "surface", "peer_key") DO UPDATE
      SET
        "window_started_at" = CASE
          WHEN "assistant_abuse_peer_states"."window_started_at" <= ${input.windowStartedAfter}
            THEN EXCLUDED."window_started_at"
          ELSE "assistant_abuse_peer_states"."window_started_at"
        END,
        "request_count" = CASE
          WHEN "assistant_abuse_peer_states"."window_started_at" <= ${input.windowStartedAfter}
            THEN 1
          ELSE "assistant_abuse_peer_states"."request_count" + 1
        END,
        "last_seen_at" = EXCLUDED."last_seen_at",
        "updated_at" = EXCLUDED."last_seen_at"
      RETURNING *
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("Peer abuse state upsert returned no row.");
    }
    return this.toPeerDomain(row);
  }

  async registerDistributedAttempt(
    input: RegisterDistributedAbuseAttemptInput
  ): Promise<RegisterDistributedAbuseAttemptResult> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.registerDistributedAttemptTx(tx, input),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
          }
        );
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Distributed abuse attempt registration exhausted retries.");
  }

  async upsertUserState(input: {
    assistantId: string;
    userId: string;
    workspaceId: string;
    surface: AbuseSurface;
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }): Promise<AssistantAbuseGuardState> {
    const row = await this.prisma.assistantAbuseGuardState.upsert({
      where: {
        assistantId_userId_surface: {
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface
        }
      },
      create: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: input.surface,
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      },
      update: {
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      }
    });
    return this.toUserDomain(row);
  }

  async upsertAssistantState(input: {
    assistantId: string;
    surface: AbuseSurface;
    windowStartedAt: Date;
    requestCount: number;
    slowedUntil: Date | null;
    blockedUntil: Date | null;
    blockReason: string | null;
    adminOverrideUntil: Date | null;
    lastSeenAt: Date;
  }): Promise<AssistantAbuseAssistantState> {
    const row = await this.prisma.assistantAbuseAssistantState.upsert({
      where: {
        assistantId_surface: {
          assistantId: input.assistantId,
          surface: input.surface
        }
      },
      create: {
        assistantId: input.assistantId,
        surface: input.surface,
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      },
      update: {
        windowStartedAt: input.windowStartedAt,
        requestCount: input.requestCount,
        slowedUntil: input.slowedUntil,
        blockedUntil: input.blockedUntil,
        blockReason: input.blockReason,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: input.lastSeenAt
      }
    });
    return this.toAssistantDomain(row);
  }

  async applyAdminUnblock(input: {
    assistantId: string;
    userId: string | null;
    surface: AbuseSurface;
    adminOverrideUntil: Date;
  }): Promise<{ userRows: number; assistantRows: number }> {
    const where = {
      assistantId: input.assistantId,
      surface: input.surface,
      ...(input.userId === null ? {} : { userId: input.userId })
    };
    const userResult = await this.prisma.assistantAbuseGuardState.updateMany({
      where,
      data: {
        blockedUntil: null,
        slowedUntil: null,
        blockReason: null,
        requestCount: 0,
        windowStartedAt: new Date(),
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: new Date()
      }
    });
    const assistantResult = await this.prisma.assistantAbuseAssistantState.updateMany({
      where: {
        assistantId: input.assistantId,
        surface: input.surface
      },
      data: {
        blockedUntil: null,
        slowedUntil: null,
        blockReason: null,
        requestCount: 0,
        windowStartedAt: new Date(),
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: new Date()
      }
    });
    return {
      userRows: userResult.count,
      assistantRows: assistantResult.count
    };
  }

  async applyPeerAdminUnblock(input: {
    assistantId: string;
    surface: AbuseSurface;
    adminOverrideUntil: Date;
  }): Promise<number> {
    const result = await this.prisma.assistantAbusePeerState.updateMany({
      where: {
        assistantId: input.assistantId,
        surface: input.surface
      },
      data: {
        requestCount: 0,
        windowStartedAt: new Date(),
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: new Date()
      }
    });
    return result.count;
  }

  private async registerDistributedAttemptTx(
    tx: Prisma.TransactionClient,
    input: RegisterDistributedAbuseAttemptInput
  ): Promise<RegisterDistributedAbuseAttemptResult> {
    const userRow = await tx.assistantAbuseGuardState.findUnique({
      where: {
        assistantId_userId_surface: {
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface
        }
      }
    });
    const assistantRow = await tx.assistantAbuseAssistantState.findUnique({
      where: {
        assistantId_surface: {
          assistantId: input.assistantId,
          surface: input.surface
        }
      }
    });

    const userState = userRow === null ? null : this.toUserDomain(userRow);
    const assistantState = assistantRow === null ? null : this.toAssistantDomain(assistantRow);
    const userAfterQuota = abuseDecisionAfterQuotaReconciled(userState, input.quotaDecision);
    const assistantAfterQuota = abuseDecisionAfterQuotaReconciled(
      assistantState,
      input.quotaDecision
    );
    const userBypass =
      userState !== null &&
      userState.adminOverrideUntil != null &&
      userState.adminOverrideUntil.getTime() > input.attemptedAt.getTime();
    const assistantBypass =
      assistantState !== null &&
      assistantState.adminOverrideUntil != null &&
      assistantState.adminOverrideUntil.getTime() > input.attemptedAt.getTime();

    const userWindowStartedAt =
      userState === null ||
      input.attemptedAt.getTime() - userState.windowStartedAt.getTime() > input.windowMs
        ? input.attemptedAt
        : userState.windowStartedAt;
    const assistantWindowStartedAt =
      assistantState === null ||
      input.attemptedAt.getTime() - assistantState.windowStartedAt.getTime() > input.windowMs
        ? input.attemptedAt
        : assistantState.windowStartedAt;

    const userCount =
      userState === null || userWindowStartedAt.getTime() === input.attemptedAt.getTime()
        ? 1
        : userState.requestCount + 1;
    const assistantCount =
      assistantState === null || assistantWindowStartedAt.getTime() === input.attemptedAt.getTime()
        ? 1
        : assistantState.requestCount + 1;

    let userDecision: AbuseDecisionSnapshot = {
      blockedUntil: userAfterQuota.blockedUntil,
      slowedUntil: userAfterQuota.slowedUntil,
      reason: userAfterQuota.reason
    };
    if (!userBypass) {
      if (userCount >= input.userBlockRequestsPerMinute) {
        userDecision = {
          blockedUntil: new Date(input.attemptedAt.getTime() + input.tempBlockSeconds * 1000),
          slowedUntil: null,
          reason: "user_request_rate_limit_blocked"
        };
      } else if (userCount >= input.userSlowdownRequestsPerMinute) {
        userDecision = {
          blockedUntil: null,
          slowedUntil: new Date(input.attemptedAt.getTime() + input.slowdownSeconds * 1000),
          reason: "user_request_rate_limit_slowdown"
        };
      }
    }

    let assistantDecision: AbuseDecisionSnapshot = {
      blockedUntil: assistantAfterQuota.blockedUntil,
      slowedUntil: assistantAfterQuota.slowedUntil,
      reason: assistantAfterQuota.reason
    };
    if (!assistantBypass) {
      if (assistantCount >= input.assistantBlockRequestsPerMinute) {
        assistantDecision = {
          blockedUntil: new Date(input.attemptedAt.getTime() + input.tempBlockSeconds * 1000),
          slowedUntil: null,
          reason: "assistant_request_rate_limit_blocked"
        };
      } else if (assistantCount >= input.assistantSlowdownRequestsPerMinute) {
        assistantDecision = {
          blockedUntil: null,
          slowedUntil: new Date(input.attemptedAt.getTime() + input.slowdownSeconds * 1000),
          reason: "assistant_request_rate_limit_slowdown"
        };
      }
    }

    const finalBlockedUntil = maxDate(
      maxDate(userDecision.blockedUntil, assistantDecision.blockedUntil),
      input.quotaDecision.blockedUntil
    );
    const finalSlowedUntil = maxDate(
      maxDate(userDecision.slowedUntil, assistantDecision.slowedUntil),
      input.quotaDecision.slowedUntil
    );
    const finalReason =
      input.quotaDecision.reason ?? assistantDecision.reason ?? userDecision.reason ?? null;

    const savedUserRow = await tx.assistantAbuseGuardState.upsert({
      where: {
        assistantId_userId_surface: {
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface
        }
      },
      create: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: input.surface,
        windowStartedAt: userWindowStartedAt,
        requestCount: userCount,
        slowedUntil: finalSlowedUntil,
        blockedUntil: finalBlockedUntil,
        blockReason: finalReason,
        adminOverrideUntil: userBypass ? (userState?.adminOverrideUntil ?? null) : null,
        lastSeenAt: input.attemptedAt
      },
      update: {
        windowStartedAt: userWindowStartedAt,
        requestCount: userCount,
        slowedUntil: finalSlowedUntil,
        blockedUntil: finalBlockedUntil,
        blockReason: finalReason,
        adminOverrideUntil: userBypass ? (userState?.adminOverrideUntil ?? null) : null,
        lastSeenAt: input.attemptedAt
      }
    });
    const savedAssistantRow = await tx.assistantAbuseAssistantState.upsert({
      where: {
        assistantId_surface: {
          assistantId: input.assistantId,
          surface: input.surface
        }
      },
      create: {
        assistantId: input.assistantId,
        surface: input.surface,
        windowStartedAt: assistantWindowStartedAt,
        requestCount: assistantCount,
        slowedUntil: finalSlowedUntil,
        blockedUntil: finalBlockedUntil,
        blockReason: finalReason,
        adminOverrideUntil: assistantBypass ? (assistantState?.adminOverrideUntil ?? null) : null,
        lastSeenAt: input.attemptedAt
      },
      update: {
        windowStartedAt: assistantWindowStartedAt,
        requestCount: assistantCount,
        slowedUntil: finalSlowedUntil,
        blockedUntil: finalBlockedUntil,
        blockReason: finalReason,
        adminOverrideUntil: assistantBypass ? (assistantState?.adminOverrideUntil ?? null) : null,
        lastSeenAt: input.attemptedAt
      }
    });

    return {
      userState: this.toUserDomain(savedUserRow),
      assistantState: this.toAssistantDomain(savedAssistantRow),
      userBypass,
      assistantBypass,
      finalBlockedUntil,
      finalSlowedUntil,
      finalReason
    };
  }

  private toUserDomain(row: PrismaAssistantAbuseGuardState): AssistantAbuseGuardState {
    return {
      id: row.id,
      assistantId: row.assistantId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      surface: row.surface,
      windowStartedAt: row.windowStartedAt,
      requestCount: row.requestCount,
      slowedUntil: row.slowedUntil ?? null,
      blockedUntil: row.blockedUntil ?? null,
      blockReason: row.blockReason ?? null,
      adminOverrideUntil: row.adminOverrideUntil ?? null,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private toAssistantDomain(row: PrismaAssistantAbuseAssistantState): AssistantAbuseAssistantState {
    return {
      id: row.id,
      assistantId: row.assistantId,
      surface: row.surface,
      windowStartedAt: row.windowStartedAt,
      requestCount: row.requestCount,
      slowedUntil: row.slowedUntil ?? null,
      blockedUntil: row.blockedUntil ?? null,
      blockReason: row.blockReason ?? null,
      adminOverrideUntil: row.adminOverrideUntil ?? null,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  /**
   * Map a peer-state row to domain. Accepts both camelCase (Prisma client)
   * and snake_case ($queryRaw RETURNING *) shapes so the same mapper works
   * regardless of how the row was obtained.
   */
  private toPeerDomain(row: Record<string, unknown>): AssistantAbusePeerState {
    const get = <T>(camel: string, snake: string): T =>
      ((row as Record<string, unknown>)[camel] ?? (row as Record<string, unknown>)[snake]) as T;

    return {
      id: get<string>("id", "id"),
      assistantId: get<string>("assistantId", "assistant_id"),
      surface: get<AbuseSurface>("surface", "surface"),
      peerKey: get<string>("peerKey", "peer_key"),
      windowStartedAt: get<Date>("windowStartedAt", "window_started_at"),
      requestCount: get<number>("requestCount", "request_count"),
      adminOverrideUntil: get<Date | null>("adminOverrideUntil", "admin_override_until") ?? null,
      lastSeenAt: get<Date>("lastSeenAt", "last_seen_at"),
      createdAt: get<Date>("createdAt", "created_at"),
      updatedAt: get<Date>("updatedAt", "updated_at")
    };
  }
}
