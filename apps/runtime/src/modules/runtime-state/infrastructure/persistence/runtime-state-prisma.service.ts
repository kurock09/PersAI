import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import { PrismaClient } from "@prisma/client";
import { RUNTIME_CONFIG } from "../../../../runtime-config";

@Injectable()
export class RuntimeStatePrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
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
