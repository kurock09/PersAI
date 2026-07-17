import type {
  RuntimeBundleSkillScenarioStep,
  RuntimeScriptInputSource
} from "@persai/runtime-contract";
import { parseScriptRef, type SkillScenarioScriptRef } from "./skill-scenario.types";
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

/**
 * ADR-151 — resolves every raw, unparsed `scriptRef` scenario-step value into
 * the exact immutable pin. This is the canonical materialization boundary:
 * it is the first point in the normalization/materialization pipeline that
 * both (a) has the `skillId` needed to build a stable
 * `ScriptRefMaterializationError` and (b) is the designated place authored
 * `scriptRef` values are parsed/validated for the runtime path, via the exact
 * same `parseScriptRef` the Admin authoring path uses. Only an authored
 * explicit `null`/absent value remains `null`. Every other value fails
 * closed with a typed `ScriptRefMaterializationError`: a malformed non-null
 * `scriptRef` or a malformed nested `inputMapping`/source entry (caught here,
 * before any database round-trip), an authored reference with no live
 * `SkillScript` link, or a mapping that cannot satisfy the pinned Script's
 * published input schema. `inputMapping` is carried through unchanged once
 * parsed (the runtime maps inputs; the API never interprets
 * `literal`/`current_user_message`/`tool_input` sources). Runs at most one
 * query per distinct `scriptKey` referenced across the given steps, not per
 * step.
 */
export async function materializeScenarioStepScriptRefs(params: {
  prisma: ScriptRefMaterializationPrismaClient;
  skillId: string;
  steps: NormalizedSkillScenarioStep[];
}): Promise<RuntimeBundleSkillScenarioStep[]> {
  const parsedSteps = params.steps.map((step) => ({
    step,
    ref: parseAuthoredScriptRefOrFail(params.skillId, step.scriptRef)
  }));
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
  return parsedSteps.map(({ step, ref }) => {
    if (ref === null) {
      return { ...step, scriptRef: null };
    }
    const pin = pinsByScriptKey.get(ref.scriptKey) ?? null;
    if (pin === null) {
      throw new ScriptRefMaterializationError(params.skillId, ref.scriptKey);
    }
    if (!isMappingCompatibleWithInputSchema(ref.inputMapping, pin.inputSchema)) {
      throw new ScriptRefMaterializationError(params.skillId, ref.scriptKey);
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

/**
 * ADR-151 repair — a persisted non-null `scriptRef` (or a malformed nested
 * `inputMapping`/source entry) that fails the canonical parser must fail
 * bundle materialization closed with a typed `ScriptRefMaterializationError`,
 * not silently canonicalize to `null` the way the earlier hand-rolled
 * runtime-only normalizer used to.
 */
function parseAuthoredScriptRefOrFail(
  skillId: string,
  rawScriptRef: unknown
): SkillScenarioScriptRef | null {
  try {
    return parseScriptRef(rawScriptRef, "scriptRef");
  } catch (error) {
    throw new ScriptRefMaterializationError(
      skillId,
      extractScriptKeyGuess(rawScriptRef),
      error instanceof Error ? error.message : "scriptRef is malformed."
    );
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
