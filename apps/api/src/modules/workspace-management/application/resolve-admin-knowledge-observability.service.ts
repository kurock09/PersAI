import { Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  KnowledgeRetrievalObservabilityService,
  type KnowledgeRetrievalObservabilityState
} from "./knowledge-retrieval-observability.service";

@Injectable()
export class ResolveAdminKnowledgeObservabilityService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly knowledgeRetrievalObservabilityService: KnowledgeRetrievalObservabilityService
  ) {}

  async execute(userId: string): Promise<KnowledgeRetrievalObservabilityState> {
    const access = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.knowledgeRetrievalObservabilityService.getSnapshot(access.workspaceId);
  }
}
