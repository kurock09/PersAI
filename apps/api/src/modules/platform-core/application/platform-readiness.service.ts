import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "../../identity-access/infrastructure/persistence/prisma.service";
import { WorkspaceManagementPrismaService } from "../../workspace-management/infrastructure/persistence/workspace-management-prisma.service";

export type PlatformReadinessDependencyName = "identity_access_db" | "workspace_management_db";

export type PlatformReadinessDependencySnapshot = {
  name: PlatformReadinessDependencyName;
  ready: boolean;
  durationMs: number;
  error: string | null;
};

export type PlatformReadinessSnapshot = {
  ready: boolean;
  checkedAt: string;
  dependencies: PlatformReadinessDependencySnapshot[];
};

const READINESS_CACHE_TTL_MS = 5_000;

@Injectable()
export class PlatformReadinessService {
  private readonly logger = new Logger(PlatformReadinessService.name);
  private cachedSnapshot: PlatformReadinessSnapshot | null = null;
  private cacheExpiresAt = 0;
  private pendingSnapshot: Promise<PlatformReadinessSnapshot> | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  async getSnapshot(force = false): Promise<PlatformReadinessSnapshot> {
    const now = Date.now();
    if (!force && this.cachedSnapshot && now < this.cacheExpiresAt) {
      return this.cachedSnapshot;
    }

    if (!this.pendingSnapshot) {
      this.pendingSnapshot = this.collectSnapshot();
    }

    try {
      const snapshot = await this.pendingSnapshot;
      this.cachedSnapshot = snapshot;
      this.cacheExpiresAt = Date.now() + READINESS_CACHE_TTL_MS;
      return snapshot;
    } finally {
      this.pendingSnapshot = null;
    }
  }

  private async collectSnapshot(): Promise<PlatformReadinessSnapshot> {
    const dependencies = await Promise.all([
      this.checkDependency(
        "identity_access_db",
        this.moduleRef.get(PrismaService, { strict: false })
      ),
      this.checkDependency(
        "workspace_management_db",
        this.moduleRef.get(WorkspaceManagementPrismaService, { strict: false })
      )
    ]);

    return {
      ready: dependencies.every((dependency) => dependency.ready),
      checkedAt: new Date().toISOString(),
      dependencies
    };
  }

  private async checkDependency(
    name: PlatformReadinessDependencyName,
    prisma:
      | Pick<PrismaService, "$queryRaw">
      | Pick<WorkspaceManagementPrismaService, "$queryRaw">
      | undefined
  ): Promise<PlatformReadinessDependencySnapshot> {
    const startedAt = Date.now();

    try {
      if (!prisma) {
        throw new Error("provider_not_registered");
      }

      await prisma.$queryRaw`SELECT 1`;

      return {
        name,
        ready: true,
        durationMs: Date.now() - startedAt,
        error: null
      };
    } catch (error) {
      this.logger.warn(`Readiness check failed for ${name}: ${this.normalizeError(error)}`);

      return {
        name,
        ready: false,
        durationMs: Date.now() - startedAt,
        error: this.sanitizeError(error)
      };
    }
  }

  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private sanitizeError(error: unknown): string {
    if (error instanceof Error && error.message === "provider_not_registered") {
      return "check_failed";
    }

    return "dependency_unavailable";
  }
}
