import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

function resolvePrismaDatasourceUrl(): string | undefined {
  const databaseUrl = process.env.DATABASE_URL;
  const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT?.trim();

  if (!databaseUrl || !connectionLimit) {
    return undefined;
  }

  try {
    const url = new URL(databaseUrl);
    // ADR-091 audit: make the documented pool limit env actually drive Prisma.
    url.searchParams.set("connection_limit", connectionLimit);
    return url.toString();
  } catch {
    return undefined;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const datasourceUrl = resolvePrismaDatasourceUrl();
    super({
      ...(datasourceUrl === undefined
        ? {}
        : {
            datasources: {
              db: {
                url: datasourceUrl
              }
            }
          })
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
