import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AssistantGovernance } from "../domain/assistant-governance.entity";
import { createDefaultMemoryControlEnvelope } from "../domain/assistant-memory-control.defaults";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import type { AssistantMaterializationSourceAction } from "../domain/assistant-materialized-spec.entity";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type { Assistant } from "../domain/assistant.entity";

const MATERIALIZATION_ALGORITHM_VERSION = 1;
const MATERIALIZATION_SCHEMA = "persai.materialization.v1";
const OPENCLAW_BOOTSTRAP_SCHEMA = "openclaw.bootstrap.v1";
const OPENCLAW_WORKSPACE_SCHEMA = "openclaw.workspace.v1";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, nestedValue] of entries) {
      sorted[key] = sortKeysDeep(nestedValue);
    }
    return sorted;
  }

  return value;
}

function toDeterministicDocument(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

function parsePolicyObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function resolveEffectiveMemoryControl(governance: AssistantGovernance): Record<string, unknown> {
  const direct = governance.memoryControl;
  if (direct !== null && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const policyEnvelope = parsePolicyObject(governance.policyEnvelope);
  const legacy = parsePolicyObject(policyEnvelope?.memoryControl ?? null);
  if (legacy !== null) {
    return legacy;
  }

  return createDefaultMemoryControlEnvelope();
}

@Injectable()
export class MaterializeAssistantPublishedVersionService {
  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository
  ) {}

  async execute(
    assistant: Assistant,
    publishedVersion: AssistantPublishedVersion,
    sourceAction: AssistantMaterializationSourceAction
  ): Promise<void> {
    const existingSpec = await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
      publishedVersion.id
    );
    if (existingSpec !== null) {
      return;
    }

    const governance =
      (await this.assistantGovernanceRepository.findByAssistantId(assistant.id)) ??
      (await this.assistantGovernanceRepository.createBaseline(assistant.id));

    const memoryControl = resolveEffectiveMemoryControl(governance);

    const layers = {
      schema: MATERIALIZATION_SCHEMA,
      algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
      layers: {
        ownership: {
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId
        },
        userOwnedVersion: {
          publishedVersionId: publishedVersion.id,
          publishedVersion: publishedVersion.version,
          snapshot: {
            displayName: publishedVersion.snapshotDisplayName,
            instructions: publishedVersion.snapshotInstructions
          }
        },
        governance: this.toGovernanceLayer(governance),
        applyState: {
          status: assistant.applyStatus,
          targetPublishedVersionId: assistant.applyTargetVersionId,
          appliedPublishedVersionId: assistant.applyAppliedVersionId
        }
      }
    };

    const openclawBootstrap = {
      schema: OPENCLAW_BOOTSTRAP_SCHEMA,
      assistant: {
        id: assistant.id,
        workspaceId: assistant.workspaceId
      },
      governance: {
        capabilityEnvelope: governance.capabilityEnvelope,
        policyEnvelope: governance.policyEnvelope,
        quota: {
          planCode: governance.quotaPlanCode,
          hook: governance.quotaHook
        },
        secretRefs: governance.secretRefs,
        auditHook: governance.auditHook
      }
    };

    const openclawWorkspace = {
      schema: OPENCLAW_WORKSPACE_SCHEMA,
      workspace: {
        assistantId: assistant.id,
        publishedVersionId: publishedVersion.id,
        publishedVersion: publishedVersion.version
      },
      persona: {
        displayName: publishedVersion.snapshotDisplayName,
        instructions: publishedVersion.snapshotInstructions
      },
      memoryControl
    };

    const layersDocument = toDeterministicDocument(layers);
    const openclawBootstrapDocument = toDeterministicDocument(openclawBootstrap);
    const openclawWorkspaceDocument = toDeterministicDocument(openclawWorkspace);
    const contentHash = createHash("sha256")
      .update(`${layersDocument}\n${openclawBootstrapDocument}\n${openclawWorkspaceDocument}`)
      .digest("hex");

    await this.assistantMaterializedSpecRepository.create({
      assistantId: assistant.id,
      publishedVersionId: publishedVersion.id,
      sourceAction,
      algorithmVersion: MATERIALIZATION_ALGORITHM_VERSION,
      layers,
      openclawBootstrap,
      openclawWorkspace,
      layersDocument,
      openclawBootstrapDocument,
      openclawWorkspaceDocument,
      contentHash
    });
  }

  private toGovernanceLayer(governance: AssistantGovernance): Record<string, unknown> {
    return {
      capabilityEnvelope: governance.capabilityEnvelope,
      secretRefs: governance.secretRefs,
      policyEnvelope: governance.policyEnvelope,
      memoryControl: governance.memoryControl,
      quota: {
        planCode: governance.quotaPlanCode,
        hook: governance.quotaHook
      },
      auditHook: governance.auditHook
    };
  }
}
