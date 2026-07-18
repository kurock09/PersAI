import type {
  RuntimeBundleSkillScenarioStep,
  RuntimeScriptInputSource
} from "@persai/runtime-contract";
import { parseScriptRef, type SkillScenarioScriptRef } from "./skill-scenario.types";
import type { NormalizedSkillScenarioStep } from "./skill-scenario-runtime-normalization";

/**
 * Narrow Prisma read surface for Script-pin resolution during Skill scenario
 * materialization. One `findFirst` per distinct `scriptKey` resolves whether
 * the owning Skill still has a live published SkillScript link and returns
 * the exact `currentPublishedVersion` pin.
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

/**
 * Typed authoring/publish error. Bundle materialization no longer throws this
 * for live chat admission: unresolvable step refs degrade to `scriptRef: null`
 * so one broken Script cannot take down the whole assistant.
 */
export class ScriptRefMaterializationError extends Error {
  readonly code = SCRIPT_REF_MATERIALIZATION_ERROR_CODE;

  constructor(
    readonly skillId: string,
    readonly scriptKey: string,
    readonly detail?: string
  ) {
    super(
      detail === undefined
        ? `Script reference "${scriptKey}" cannot be materialized for Skill ${skillId}.`
        : `Script reference "${scriptKey}" cannot be materialized for Skill ${skillId}: ${detail}`
    );
    this.name = "ScriptRefMaterializationError";
  }
}

export type ScriptRefStepDegradation = {
  skillId: string;
  stepNumber: number;
  scriptKey: string;
  reason: string;
};

/**
 * Resolves every raw scenario-step `scriptRef` into an exact immutable pin.
 *
 * Isolation rule: an authored non-null reference that cannot parse, resolve,
 * or satisfy the published input schema degrades that step to `scriptRef: null`
 * and records a degradation. Other steps and the rest of the assistant bundle
 * continue. Publish/authoring paths still use
 * {@link isMappingCompatibleWithInputSchema} / {@link ScriptRefMaterializationError}
 * to fail closed before assistants are dirtied.
 */
export async function materializeScenarioStepScriptRefs(params: {
  prisma: ScriptRefMaterializationPrismaClient;
  skillId: string;
  steps: NormalizedSkillScenarioStep[];
  onDegraded?: (degradation: ScriptRefStepDegradation) => void;
}): Promise<RuntimeBundleSkillScenarioStep[]> {
  const parsedSteps = params.steps.map((step) => parseStepScriptRef(step));
  const distinctScriptKeys = [
    ...new Set(
      parsedSteps
        .map(({ ref }) => ref?.scriptKey)
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

  return parsedSteps.map(({ step, ref, parseFailure }) => {
    if (parseFailure !== null) {
      emitDegraded(params, {
        skillId: params.skillId,
        stepNumber: step.number,
        scriptKey: parseFailure.scriptKey,
        reason: parseFailure.reason
      });
      return { ...step, scriptRef: null };
    }
    if (ref === null) {
      return { ...step, scriptRef: null };
    }
    const pin = pinsByScriptKey.get(ref.scriptKey) ?? null;
    if (pin === null) {
      emitDegraded(params, {
        skillId: params.skillId,
        stepNumber: step.number,
        scriptKey: ref.scriptKey,
        reason: "no live published SkillScript pin (missing link, version, or contentHash)"
      });
      return { ...step, scriptRef: null };
    }
    const mappingProblem = describeMappingIncompatibility(ref.inputMapping, pin.inputSchema);
    if (mappingProblem !== null) {
      emitDegraded(params, {
        skillId: params.skillId,
        stepNumber: step.number,
        scriptKey: ref.scriptKey,
        reason: mappingProblem
      });
      return { ...step, scriptRef: null };
    }
    return {
      ...step,
      scriptRef: {
        scriptKey: ref.scriptKey,
        scriptId: pin.scriptId,
        scriptVersionId: pin.scriptVersionId,
        versionNumber: pin.versionNumber,
        contentHash: pin.contentHash,
        inputMapping: ref.inputMapping as Record<string, RuntimeScriptInputSource>,
        inputSchema: pin.inputSchema
      }
    };
  });
}

function emitDegraded(
  params: {
    skillId: string;
    onDegraded?: (degradation: ScriptRefStepDegradation) => void;
  },
  degradation: ScriptRefStepDegradation
): void {
  params.onDegraded?.(degradation);
}

function parseStepScriptRef(step: NormalizedSkillScenarioStep): {
  step: NormalizedSkillScenarioStep;
  ref: SkillScenarioScriptRef | null;
  parseFailure: { scriptKey: string; reason: string } | null;
} {
  try {
    return {
      step,
      ref: parseScriptRef(step.scriptRef, "scriptRef"),
      parseFailure: null
    };
  } catch (error) {
    return {
      step,
      ref: null,
      parseFailure: {
        scriptKey: extractScriptKeyGuess(step.scriptRef),
        reason: error instanceof Error ? error.message : "scriptRef is malformed."
      }
    };
  }
}

function extractScriptKeyGuess(rawScriptRef: unknown): string {
  if (rawScriptRef !== null && typeof rawScriptRef === "object" && !Array.isArray(rawScriptRef)) {
    const scriptKey = (rawScriptRef as Record<string, unknown>).scriptKey;
    if (typeof scriptKey === "string" && scriptKey.trim().length > 0) {
      return scriptKey.trim();
    }
  }
  return "<malformed>";
}

/** True when every schema-required key is present in the authored mapping. */
export function isMappingCompatibleWithInputSchema(
  inputMapping: Record<string, unknown>,
  inputSchema: Record<string, unknown>
): boolean {
  return describeMappingIncompatibility(inputMapping, inputSchema) === null;
}

/** Human-readable incompatibility, or null when the mapping is compatible. */
export function describeMappingIncompatibility(
  inputMapping: Record<string, unknown>,
  inputSchema: Record<string, unknown>
): string | null {
  if (inputSchema.type !== "object") {
    return "published inputSchema.type must be object";
  }
  const properties =
    inputSchema.properties !== null &&
    typeof inputSchema.properties === "object" &&
    !Array.isArray(inputSchema.properties)
      ? (inputSchema.properties as Record<string, unknown>)
      : {};
  if (inputSchema.additionalProperties === false) {
    const unknownKeys = Object.keys(inputMapping).filter(
      (key) => !Object.prototype.hasOwnProperty.call(properties, key)
    );
    if (unknownKeys.length > 0) {
      return `inputMapping has keys not allowed by additionalProperties:false: ${unknownKeys.join(", ")}`;
    }
  }
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  const missing = required.filter(
    (key) => !Object.prototype.hasOwnProperty.call(inputMapping, key)
  );
  if (missing.length > 0) {
    return `inputMapping missing required keys: ${missing.join(", ")}`;
  }
  return null;
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
