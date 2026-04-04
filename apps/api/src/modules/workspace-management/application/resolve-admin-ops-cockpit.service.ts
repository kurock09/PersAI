import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AssistantRuntimePreflightService } from "./assistant-runtime-preflight.service";
import type { AdminOpsCockpitState } from "./ops-cockpit.types";
import { resolveRuntimeBaseUrl } from "./runtime-endpoint-routing";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";

function asIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

@Injectable()
export class ResolveAdminOpsCockpitService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly assistantRuntimePreflightService: AssistantRuntimePreflightService,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService
  ) {}

  async execute(callerUserId: string, targetUserId?: string): Promise<AdminOpsCockpitState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const lookupUserId = targetUserId ?? callerUserId;
    const config = loadApiConfig(process.env);
    const assistant = await this.assistantRepository.findByUserId(lookupUserId);
    const runtimeTier = assistant
      ? await this.resolveAssistantRuntimeTierService.resolveByAssistantId(assistant.id)
      : null;
    const runtimeEndpointHost =
      config.OPENCLAW_ADAPTER_ENABLED && runtimeTier
        ? new URL(
            resolveRuntimeBaseUrl({
              config: {
                tierBaseUrls: {
                  free_shared_restricted: config.OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED!,
                  paid_shared_restricted: config.OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED!,
                  paid_isolated: config.OPENCLAW_BASE_URL_PAID_ISOLATED!
                }
              },
              runtimeTier
            }).baseUrl
          ).host
        : null;
    const preflight = await this.assistantRuntimePreflightService.execute(runtimeTier ?? undefined);

    if (assistant === null) {
      const incidentSignals: AdminOpsCockpitState["incidentSignals"] = [
        {
          code: "assistant_absent",
          severity: "elevated",
          message: "No assistant exists for this operator account."
        }
      ];
      if (!preflight.live || !preflight.ready) {
        incidentSignals.push({
          code: "runtime_preflight_unhealthy",
          severity: "high",
          message: "Runtime preflight is not healthy (live/ready check failed)."
        });
      }
      return {
        assistant: {
          exists: false,
          assistantId: null,
          workspaceId: null,
          latestPublishedVersion: {
            id: null,
            version: null,
            publishedAt: null
          },
          runtimeApply: null
        },
        runtime: {
          adapterEnabled: config.OPENCLAW_ADAPTER_ENABLED,
          runtimeTier,
          runtimeEndpointHost,
          preflight
        },
        controls: {
          reapplySupported: false,
          restartSupported: false
        },
        incidentSignals,
        updatedAt: new Date().toISOString()
      };
    }

    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
    const incidentSignals: AdminOpsCockpitState["incidentSignals"] = [];

    if (!preflight.live || !preflight.ready) {
      incidentSignals.push({
        code: "runtime_preflight_unhealthy",
        severity: "high",
        message: "Runtime preflight is not healthy (live/ready check failed)."
      });
    }

    if (latestPublishedVersion === null) {
      incidentSignals.push({
        code: "assistant_not_published",
        severity: "elevated",
        message: "Assistant has no published version."
      });
    }

    if (assistant.applyStatus === "failed") {
      incidentSignals.push({
        code: "runtime_apply_failed",
        severity: "high",
        message: "Latest runtime apply failed."
      });
    } else if (assistant.applyStatus === "degraded") {
      incidentSignals.push({
        code: "runtime_apply_degraded",
        severity: "elevated",
        message: "Latest runtime apply completed in degraded mode."
      });
    } else if (assistant.applyStatus === "in_progress") {
      incidentSignals.push({
        code: "runtime_apply_in_progress",
        severity: "info",
        message: "Runtime apply is currently in progress."
      });
    }

    return {
      assistant: {
        exists: true,
        assistantId: assistant.id,
        workspaceId: assistant.workspaceId,
        latestPublishedVersion: {
          id: latestPublishedVersion?.id ?? null,
          version: latestPublishedVersion?.version ?? null,
          publishedAt: asIso(latestPublishedVersion?.createdAt ?? null)
        },
        runtimeApply: {
          status: assistant.applyStatus,
          targetPublishedVersionId: assistant.applyTargetVersionId,
          appliedPublishedVersionId: assistant.applyAppliedVersionId,
          requestedAt: asIso(assistant.applyRequestedAt),
          startedAt: asIso(assistant.applyStartedAt),
          finishedAt: asIso(assistant.applyFinishedAt),
          error:
            assistant.applyErrorCode === null && assistant.applyErrorMessage === null
              ? null
              : {
                  code: assistant.applyErrorCode,
                  message: assistant.applyErrorMessage
                }
        }
      },
      runtime: {
        adapterEnabled: config.OPENCLAW_ADAPTER_ENABLED,
        runtimeTier,
        runtimeEndpointHost,
        preflight
      },
      controls: {
        reapplySupported: latestPublishedVersion !== null,
        restartSupported: false
      },
      incidentSignals,
      updatedAt: new Date().toISOString()
    };
  }
}
