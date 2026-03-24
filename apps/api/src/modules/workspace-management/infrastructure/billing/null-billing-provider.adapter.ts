import { Injectable } from "@nestjs/common";
import type {
  BillingProviderPort,
  BillingProviderSubscriptionSnapshot
} from "../../application/billing-provider.port";

@Injectable()
export class NullBillingProviderAdapter implements BillingProviderPort {
  async pullWorkspaceSubscription(
    workspaceId: string
  ): Promise<BillingProviderSubscriptionSnapshot | null> {
    void workspaceId;
    return null;
  }
}
