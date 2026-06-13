import { Inject, Injectable } from "@nestjs/common";
import {
  USER_RESTRICTION_REPOSITORY,
  type UserRestrictionRepository
} from "../domain/user-restriction.repository";
import { createAssistantInboundSafetyRestrictedError } from "./assistant-inbound-error";

@Injectable()
export class EnforceInboundSafetyGateService {
  constructor(
    @Inject(USER_RESTRICTION_REPOSITORY)
    private readonly userRestrictionRepository: UserRestrictionRepository
  ) {}

  async enforceActiveSafetyRestriction(userId: string): Promise<void> {
    const restriction = await this.userRestrictionRepository.findActiveSafetyRestriction(userId);
    if (restriction === null) {
      return;
    }

    throw createAssistantInboundSafetyRestrictedError(
      "Inbound access is restricted due to platform safety policy.",
      { reasonCode: restriction.reasonCode }
    );
  }
}
