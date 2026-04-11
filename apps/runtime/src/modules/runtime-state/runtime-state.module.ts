import { Module } from "@nestjs/common";
import { RuntimeStatePostgresService } from "./infrastructure/persistence/runtime-state-postgres.service";
import { RuntimeStatePrismaService } from "./infrastructure/persistence/runtime-state-prisma.service";
import { RuntimeStateRedisService } from "./infrastructure/coordination/runtime-state-redis.service";
import { RuntimeStateKeyspaceService } from "./runtime-state-keyspace.service";

@Module({
  providers: [
    RuntimeStateKeyspaceService,
    RuntimeStatePrismaService,
    RuntimeStatePostgresService,
    RuntimeStateRedisService
  ],
  exports: [
    RuntimeStateKeyspaceService,
    RuntimeStatePrismaService,
    RuntimeStatePostgresService,
    RuntimeStateRedisService
  ]
})
export class RuntimeStateModule {}
