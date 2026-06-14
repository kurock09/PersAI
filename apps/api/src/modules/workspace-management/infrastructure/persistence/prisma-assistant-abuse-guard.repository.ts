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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

const LEGACY_QUOTA_PRESSURE_BLOCK_REASONS = new Set([
  "quota_pressure_temporary_block",
  "quota_pressure_slowdown"
]);

function clearLegacyQuotaPressureDecision(
  persisted: {
    blockedUntil: Date | null;
    slowedUntil: Date | null;
    blockReason: string | null;
  } | null
): AbuseDecisionSnapshot {
  if (persisted === null) {
    return { blockedUntil: null, slowedUntil: null, reason: null };
  }
  const reason = persisted.blockReason ?? "";
  if (LEGACY_QUOTA_PRESSURE_BLOCK_REASONS.has(reason)) {
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
    return this.withTransactionRetry("register distributed abuse attempt", async () =>
      this.prisma.$transaction(async (tx) => this.registerDistributedAttemptTx(tx, input))
    );
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
    const now = new Date();
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
        windowStartedAt: now,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: now
      }
    });
    await this.prisma.assistantAbuseAssistantState.upsert({
      where: {
        assistantId_surface: {
          assistantId: input.assistantId,
          surface: input.surface
        }
      },
      create: {
        assistantId: input.assistantId,
        surface: input.surface,
        windowStartedAt: now,
        requestCount: 0,
        blockedUntil: null,
        slowedUntil: null,
        blockReason: null,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: now
      },
      update: {
        blockedUntil: null,
        slowedUntil: null,
        blockReason: null,
        requestCount: 0,
        windowStartedAt: now,
        adminOverrideUntil: input.adminOverrideUntil,
        lastSeenAt: now
      }
    });
    return {
      userRows: userResult.count,
      assistantRows: 1
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
    const userState = await this.lockOrCreateUserStateRow(tx, input);
    const assistantState = await this.lockOrCreateAssistantStateRow(tx, input);
    const userBaseline = clearLegacyQuotaPressureDecision(userState);
    const assistantBaseline = clearLegacyQuotaPressureDecision(assistantState);
    const userBypass =
      userState.adminOverrideUntil != null &&
      userState.adminOverrideUntil.getTime() > input.attemptedAt.getTime();
    const assistantBypass =
      assistantState.adminOverrideUntil != null &&
      assistantState.adminOverrideUntil.getTime() > input.attemptedAt.getTime();

    const userWindowStartedAt =
      input.attemptedAt.getTime() - userState.windowStartedAt.getTime() > input.windowMs
        ? input.attemptedAt
        : userState.windowStartedAt;
    const assistantWindowStartedAt =
      input.attemptedAt.getTime() - assistantState.windowStartedAt.getTime() > input.windowMs
        ? input.attemptedAt
        : assistantState.windowStartedAt;

    const userCount =
      userWindowStartedAt.getTime() === input.attemptedAt.getTime()
        ? 1
        : userState.requestCount + 1;
    const assistantCount =
      assistantWindowStartedAt.getTime() === input.attemptedAt.getTime()
        ? 1
        : assistantState.requestCount + 1;

    let userDecision: AbuseDecisionSnapshot = {
      blockedUntil: userBaseline.blockedUntil,
      slowedUntil: userBaseline.slowedUntil,
      reason: userBaseline.reason
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
      blockedUntil: assistantBaseline.blockedUntil,
      slowedUntil: assistantBaseline.slowedUntil,
      reason: assistantBaseline.reason
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

    const finalBlockedUntil = maxDate(userDecision.blockedUntil, assistantDecision.blockedUntil);
    const finalSlowedUntil = maxDate(userDecision.slowedUntil, assistantDecision.slowedUntil);
    const finalReason = assistantDecision.reason ?? userDecision.reason ?? null;

    const savedUserRow = await tx.assistantAbuseGuardState.update({
      where: {
        assistantId_userId_surface: {
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface
        }
      },
      data: {
        windowStartedAt: userWindowStartedAt,
        requestCount: userCount,
        slowedUntil: finalSlowedUntil,
        blockedUntil: finalBlockedUntil,
        blockReason: finalReason,
        adminOverrideUntil: userBypass ? userState.adminOverrideUntil : null,
        lastSeenAt: input.attemptedAt
      }
    });
    const savedAssistantRow = await tx.assistantAbuseAssistantState.update({
      where: {
        assistantId_surface: {
          assistantId: input.assistantId,
          surface: input.surface
        }
      },
      data: {
        windowStartedAt: assistantWindowStartedAt,
        requestCount: assistantCount,
        slowedUntil: finalSlowedUntil,
        blockedUntil: finalBlockedUntil,
        blockReason: finalReason,
        adminOverrideUntil: assistantBypass ? assistantState.adminOverrideUntil : null,
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

  private async lockOrCreateUserStateRow(
    tx: Prisma.TransactionClient,
    input: RegisterDistributedAbuseAttemptInput
  ): Promise<AssistantAbuseGuardState> {
    const existing = await this.lockUserStateRow(
      tx,
      input.assistantId,
      input.userId,
      input.surface
    );
    if (existing !== null) {
      return existing;
    }

    const bootstrapWindowStartedAt = new Date(input.attemptedAt.getTime() - input.windowMs - 1);
    try {
      const created = await tx.assistantAbuseGuardState.create({
        data: {
          assistantId: input.assistantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          surface: input.surface,
          windowStartedAt: bootstrapWindowStartedAt,
          requestCount: 0,
          slowedUntil: null,
          blockedUntil: null,
          blockReason: null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt
        }
      });
      return this.toUserDomain(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.lockUserStateRow(
          tx,
          input.assistantId,
          input.userId,
          input.surface
        );
        if (raced !== null) {
          return raced;
        }
      }
      throw error;
    }
  }

  private async lockOrCreateAssistantStateRow(
    tx: Prisma.TransactionClient,
    input: RegisterDistributedAbuseAttemptInput
  ): Promise<AssistantAbuseAssistantState> {
    const existing = await this.lockAssistantStateRow(tx, input.assistantId, input.surface);
    if (existing !== null) {
      return existing;
    }

    const bootstrapWindowStartedAt = new Date(input.attemptedAt.getTime() - input.windowMs - 1);
    try {
      const created = await tx.assistantAbuseAssistantState.create({
        data: {
          assistantId: input.assistantId,
          surface: input.surface,
          windowStartedAt: bootstrapWindowStartedAt,
          requestCount: 0,
          slowedUntil: null,
          blockedUntil: null,
          blockReason: null,
          adminOverrideUntil: null,
          lastSeenAt: input.attemptedAt
        }
      });
      return this.toAssistantDomain(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.lockAssistantStateRow(tx, input.assistantId, input.surface);
        if (raced !== null) {
          return raced;
        }
      }
      throw error;
    }
  }

  private async lockUserStateRow(
    tx: Prisma.TransactionClient,
    assistantId: string,
    userId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseGuardState | null> {
    const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM "assistant_abuse_guard_states"
      WHERE "assistant_id" = CAST(${assistantId} AS uuid)
        AND "user_id" = CAST(${userId} AS uuid)
        AND "surface" = CAST(${surface} AS "abuse_surface")
      FOR UPDATE
    `);
    const row = rows[0];
    return row ? this.toUserDomainFromRaw(row) : null;
  }

  private async lockAssistantStateRow(
    tx: Prisma.TransactionClient,
    assistantId: string,
    surface: AbuseSurface
  ): Promise<AssistantAbuseAssistantState | null> {
    const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM "assistant_abuse_assistant_states"
      WHERE "assistant_id" = CAST(${assistantId} AS uuid)
        AND "surface" = CAST(${surface} AS "abuse_surface")
      FOR UPDATE
    `);
    const row = rows[0];
    return row ? this.toAssistantDomainFromRaw(row) : null;
  }

  private async withTransactionRetry<T>(label: string, execute: () => Promise<T>): Promise<T> {
    const maxRetries = 5;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await execute();
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          await sleep(25 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Failed to ${label} after transaction retries.`);
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

  private toUserDomainFromRaw(row: Record<string, unknown>): AssistantAbuseGuardState {
    const get = <T>(camel: string, snake: string): T =>
      ((row as Record<string, unknown>)[camel] ?? (row as Record<string, unknown>)[snake]) as T;

    return {
      id: get<string>("id", "id"),
      assistantId: get<string>("assistantId", "assistant_id"),
      userId: get<string>("userId", "user_id"),
      workspaceId: get<string>("workspaceId", "workspace_id"),
      surface: get<AbuseSurface>("surface", "surface"),
      windowStartedAt: get<Date>("windowStartedAt", "window_started_at"),
      requestCount: get<number>("requestCount", "request_count"),
      slowedUntil: get<Date | null>("slowedUntil", "slowed_until") ?? null,
      blockedUntil: get<Date | null>("blockedUntil", "blocked_until") ?? null,
      blockReason: get<string | null>("blockReason", "block_reason") ?? null,
      adminOverrideUntil: get<Date | null>("adminOverrideUntil", "admin_override_until") ?? null,
      lastSeenAt: get<Date>("lastSeenAt", "last_seen_at"),
      createdAt: get<Date>("createdAt", "created_at"),
      updatedAt: get<Date>("updatedAt", "updated_at")
    };
  }

  private toAssistantDomainFromRaw(row: Record<string, unknown>): AssistantAbuseAssistantState {
    const get = <T>(camel: string, snake: string): T =>
      ((row as Record<string, unknown>)[camel] ?? (row as Record<string, unknown>)[snake]) as T;

    return {
      id: get<string>("id", "id"),
      assistantId: get<string>("assistantId", "assistant_id"),
      surface: get<AbuseSurface>("surface", "surface"),
      windowStartedAt: get<Date>("windowStartedAt", "window_started_at"),
      requestCount: get<number>("requestCount", "request_count"),
      slowedUntil: get<Date | null>("slowedUntil", "slowed_until") ?? null,
      blockedUntil: get<Date | null>("blockedUntil", "blocked_until") ?? null,
      blockReason: get<string | null>("blockReason", "block_reason") ?? null,
      adminOverrideUntil: get<Date | null>("adminOverrideUntil", "admin_override_until") ?? null,
      lastSeenAt: get<Date>("lastSeenAt", "last_seen_at"),
      createdAt: get<Date>("createdAt", "created_at"),
      updatedAt: get<Date>("updatedAt", "updated_at")
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
