import { Injectable } from "@nestjs/common";
import { SessionLeaseService } from "../sessions/session-lease.service";
import type { AcceptedRuntimeTurn } from "./turn-acceptance.service";

export interface TurnLeaseHeartbeatResult {
  outcome: "renewed" | "lost";
}

@Injectable()
export class TurnLeaseHeartbeatService {
  constructor(private readonly sessionLeaseService: SessionLeaseService) {}

  async heartbeatAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn
  ): Promise<TurnLeaseHeartbeatResult> {
    const renewed = await this.sessionLeaseService.renewLease(acceptedTurn.lease);
    return {
      outcome: renewed ? "renewed" : "lost"
    };
  }
}
