import { randomUUID } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  LEASE_ACQUIRE_TIMEOUT_MS,
  LEASE_TTL_MS,
  SCHEDULER_KEYS,
  type SchedulerKey
} from "./scheduler-lease.constants";

const PROCESS_HOLDER_SUFFIX = randomUUID();
const PROCESS_HOLDER_ID = `pid:${process.pid}:${PROCESS_HOLDER_SUFFIX}`;

type AcquireLeaseRow = {
  leaseToken: string;
};

export type SchedulerLeaseState = {
  holderId: string;
  expiresAt: Date;
};

@Injectable()
export class SchedulerLeaseService implements OnModuleInit {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "scheduler_leases" (
        "scheduler_key",
        "holder_id",
        "lease_token",
        "expires_at",
        "last_heartbeat",
        "created_at",
        "updated_at"
      )
      VALUES ${Prisma.join(
        SCHEDULER_KEYS.map((key) => Prisma.sql`(${key}, '', '', NOW(), NOW(), NOW(), NOW())`)
      )}
      ON CONFLICT ("scheduler_key") DO NOTHING
    `);
  }

  async acquire(key: SchedulerKey): Promise<{ token: string } | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
    const token = randomUUID();

    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<AcquireLeaseRow[]>(Prisma.sql`
          UPDATE "scheduler_leases"
             SET "holder_id" = ${this.getSelfHolderId()},
                 "lease_token" = ${token},
                 "expires_at" = ${expiresAt},
                 "last_heartbeat" = ${now},
                 "updated_at" = ${now}
           WHERE "scheduler_key" = ${key}
             AND ("expires_at" < ${now} OR "holder_id" = '')
         RETURNING "lease_token" AS "leaseToken"
        `);

        const row = rows[0];
        return row ? { token: row.leaseToken } : null;
      },
      { timeout: LEASE_ACQUIRE_TIMEOUT_MS }
    );
  }

  async heartbeat(key: SchedulerKey, token: string): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);

    const updated = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "scheduler_leases"
         SET "expires_at" = ${expiresAt},
             "last_heartbeat" = ${now},
             "updated_at" = ${now}
       WHERE "scheduler_key" = ${key}
         AND "lease_token" = ${token}
    `);

    return updated > 0;
  }

  async release(key: SchedulerKey, token: string): Promise<void> {
    const now = new Date();

    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "scheduler_leases"
         SET "holder_id" = '',
             "lease_token" = '',
             "expires_at" = ${now},
             "last_heartbeat" = ${now},
             "updated_at" = ${now}
       WHERE "scheduler_key" = ${key}
         AND "lease_token" = ${token}
    `);
  }

  async getLeaseState(key: SchedulerKey): Promise<SchedulerLeaseState | null> {
    return this.prisma.schedulerLease.findUnique({
      where: { schedulerKey: key },
      select: {
        holderId: true,
        expiresAt: true
      }
    });
  }

  protected getSelfHolderId(): string {
    return PROCESS_HOLDER_ID;
  }
}
