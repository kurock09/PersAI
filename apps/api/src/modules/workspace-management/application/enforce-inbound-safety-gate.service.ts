import { Inject, Injectable } from "@nestjs/common";
import {
  USER_RESTRICTION_REPOSITORY,
  type UserRestrictionRepository
} from "../domain/user-restriction.repository";
import { SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE } from "../domain/safety-policy.types";
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
      SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE,
      {
        reasonCode: restriction.reasonCode
      }
    );
  }
}
