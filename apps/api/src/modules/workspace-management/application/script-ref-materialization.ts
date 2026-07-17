import type {
  RuntimeBundleSkillScenarioStep,
  RuntimeScriptInputSource
} from "@persai/runtime-contract";
import type { NormalizedSkillScenarioStep } from "./skill-scenario-runtime-normalization";

/**
 * ADR-151 — the narrow read surface the materializer needs from Prisma. A
 * single `findFirst` per distinct `scriptKey` resolves, in one round-trip,
 * whether the owning Skill still has a live `SkillScript` link to a Script
 * that is `published` (not archived, not draft-only), and if so returns its
 * exact `currentPublishedVersion` — the pin. An authored non-null reference
 * that cannot resolve is materialization corruption/staleness and fails the
 * whole assistant bundle closed with a stable typed error.
 */
export interface ScriptRefMaterializationPrismaClient {
  skillScript: {
    findFirst(args: {
      where: { skillId: string; script: { key: string; status: "published" } };
      select: {
        script: {
          select: {
            id: true;
            currentPublishedVersion: {
              select: { id: true; version: true; contentHash: true; inputSchema: true };
            };
          };
        };
      };
    }): Promise<{
      script: {
        id: string;
        currentPublishedVersion: {
          id: string;
          version: number;
          contentHash: string | null;
          inputSchema: unknown;
        } | null;
      };
    } | null>;
  };
}

type ResolvedScriptPin = {
  scriptId: string;
  scriptVersionId: string;
  versionNumber: number;
  contentHash: string;
  inputSchema: Record<string, unknown>;
};

export const SCRIPT_REF_MATERIALIZATION_ERROR_CODE =
  "script_ref_materialization_unresolvable" as const;

export class ScriptRefMaterializationError extends Error {
  readonly code = SCRIPT_REF_MATERIALIZATION_ERROR_CODE;

  constructor(
    readonly skillId: string,
    readonly scriptKey: string
  ) {
    super(`Script reference "${scriptKey}" cannot be materialized for Skill ${skillId}.`);
    this.name = "ScriptRefMaterializationError";
  }
}

/**
 * ADR-151 — resolves every raw `{scriptKey, inputMapping}` scenario-step
 * reference into the exact immutable pin. Only an authored `null` remains
 * `null`; an unresolvable authored reference fails closed.
 * `inputMapping` is carried through unchanged (the runtime maps inputs; the
 * API never interprets `literal`/`current_user_message`/`tool_input`
 * sources). Runs one query per distinct `scriptKey` referenced across the
 * given steps, not per step.
 */
export async function materializeScenarioStepScriptRefs(params: {
  prisma: ScriptRefMaterializationPrismaClient;
  skillId: string;
  steps: NormalizedSkillScenarioStep[];
}): Promise<RuntimeBundleSkillScenarioStep[]> {
  const distinctScriptKeys = [
    ...new Set(
      params.steps
        .map((step) => step.scriptRef?.scriptKey)
        .filter((scriptKey): scriptKey is string => typeof scriptKey === "string")
    )
  ];
  const pinsByScriptKey = new Map<string, ResolvedScriptPin | null>(
    await Promise.all(
      distinctScriptKeys.map(
        async (scriptKey) =>
          [scriptKey, await resolveScriptPin(params.prisma, params.skillId, scriptKey)] as const
      )
    )
  );
  return params.steps.map((step) => {
    const raw = step.scriptRef;
    if (raw === null) {
      return { ...step, scriptRef: null };
    }
    const pin = pinsByScriptKey.get(raw.scriptKey) ?? null;
    if (pin === null) {
      throw new ScriptRefMaterializationError(params.skillId, raw.scriptKey);
    }
    if (!isMappingCompatibleWithInputSchema(raw.inputMapping, pin.inputSchema)) {
      throw new ScriptRefMaterializationError(params.skillId, raw.scriptKey);
    }
    return {
      ...step,
      scriptRef: {
        scriptKey: raw.scriptKey,
        scriptId: pin.scriptId,
        scriptVersionId: pin.scriptVersionId,
        versionNumber: pin.versionNumber,
        contentHash: pin.contentHash,
        inputMapping: raw.inputMapping as Record<string, RuntimeScriptInputSource>,
        inputSchema: pin.inputSchema
      }
    };
  });
}

function isMappingCompatibleWithInputSchema(
  inputMapping: Record<string, unknown>,
  inputSchema: Record<string, unknown>
): boolean {
  if (inputSchema.type !== "object") {
    return false;
  }
  const properties =
    inputSchema.properties !== null &&
    typeof inputSchema.properties === "object" &&
    !Array.isArray(inputSchema.properties)
      ? (inputSchema.properties as Record<string, unknown>)
      : {};
  if (
    inputSchema.additionalProperties === false &&
    Object.keys(inputMapping).some((key) => !Object.prototype.hasOwnProperty.call(properties, key))
  ) {
    return false;
  }
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  return required.every((key) => Object.prototype.hasOwnProperty.call(inputMapping, key));
}

async function resolveScriptPin(
  prisma: ScriptRefMaterializationPrismaClient,
  skillId: string,
  scriptKey: string
): Promise<ResolvedScriptPin | null> {
  const link = await prisma.skillScript.findFirst({
    where: { skillId, script: { key: scriptKey, status: "published" } },
    select: {
      script: {
        select: {
          id: true,
          currentPublishedVersion: {
            select: { id: true, version: true, contentHash: true, inputSchema: true }
          }
        }
      }
    }
  });
  const version = link?.script.currentPublishedVersion ?? null;
  if (link === null || version === null || version.contentHash === null) {
    return null;
  }
  return {
    scriptId: link.script.id,
    scriptVersionId: version.id,
    versionNumber: version.version,
    contentHash: version.contentHash,
    inputSchema: (version.inputSchema ?? {}) as Record<string, unknown>
  };
}
