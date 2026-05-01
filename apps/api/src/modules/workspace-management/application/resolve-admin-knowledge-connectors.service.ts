import { Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import type { GlobalKnowledgeSourceScope } from "./assistant-knowledge-source.types";

export type AdminKnowledgeConnectorKind = "google_drive" | "yandex_disk" | "mailru_cloud";

export type AdminKnowledgeConnectorState = {
  kind: AdminKnowledgeConnectorKind;
  label: string;
  status: "planned";
  authMode: "oauth_deferred";
  targetScope: GlobalKnowledgeSourceScope;
  syncMode: "pull_snapshot_then_index";
  storageTarget: "persai_owned_object_storage";
  indexingTarget: "knowledge_indexing_service";
  supportsScopes: GlobalKnowledgeSourceScope[];
  pipeline: string[];
  notes: string[];
};

@Injectable()
export class ResolveAdminKnowledgeConnectorsService {
  constructor(private readonly adminAuthorizationService: AdminAuthorizationService) {}

  async execute(params: {
    userId: string;
    scope: GlobalKnowledgeSourceScope;
  }): Promise<AdminKnowledgeConnectorState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(params.userId);
    return [
      this.buildConnector({
        kind: "google_drive",
        label: "Google Drive",
        scope: params.scope,
        notes: [
          "OAuth and background sync scheduler are intentionally deferred in this slice.",
          "Recommended for product docs and shared folders. Skill documents are managed through /admin/skills."
        ]
      }),
      this.buildConnector({
        kind: "yandex_disk",
        label: "Yandex Disk",
        scope: params.scope,
        notes: [
          "Sync stays read-only toward the external drive; PersAI keeps its own indexed copy.",
          "Best suited for regional doc sets that already live in Yandex-managed folders."
        ]
      }),
      this.buildConnector({
        kind: "mailru_cloud",
        label: "Mail.ru Cloud",
        scope: params.scope,
        notes: [
          "Connector contract is the same: pull file snapshot, store inside PersAI, then reindex.",
          "Folder-level sync and conflict policies will land together with OAuth support."
        ]
      })
    ];
  }

  private buildConnector(params: {
    kind: AdminKnowledgeConnectorKind;
    label: string;
    scope: GlobalKnowledgeSourceScope;
    notes: string[];
  }): AdminKnowledgeConnectorState {
    const scopeLabel = "Product KB";
    return {
      kind: params.kind,
      label: params.label,
      status: "planned",
      authMode: "oauth_deferred",
      targetScope: params.scope,
      syncMode: "pull_snapshot_then_index",
      storageTarget: "persai_owned_object_storage",
      indexingTarget: "knowledge_indexing_service",
      supportsScopes: ["product"],
      pipeline: [
        `Admin binds a ${params.label} folder or file selection to ${scopeLabel}.`,
        "Connector downloads the remote snapshot into PersAI-owned object storage.",
        "KnowledgeIndexingService extracts text, chunks content, and generates embeddings when the plan allows it.",
        "Indexed chunks land in the same global knowledge tables that manual admin uploads already use."
      ],
      notes: params.notes
    };
  }
}
