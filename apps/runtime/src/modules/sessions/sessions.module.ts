import { Module } from "@nestjs/common";
import { RuntimeStateModule } from "../runtime-state/runtime-state.module";
import { SessionLeaseService } from "./session-lease.service";
import { SessionStoreService } from "./session-store.service";

@Module({
  imports: [RuntimeStateModule],
  providers: [SessionStoreService, SessionLeaseService],
  exports: [SessionStoreService, SessionLeaseService]
})
export class SessionsModule {}
