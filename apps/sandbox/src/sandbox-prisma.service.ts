import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import { PrismaClient } from "@prisma/client";
import { SANDBOX_CONFIG } from "./sandbox-config";

@Injectable()
export class SandboxPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(SANDBOX_CONFIG) config: SandboxConfig) {
    super({
      datasources: {
        db: {
          url: config.DATABASE_URL
        }
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
