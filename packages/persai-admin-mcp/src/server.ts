import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PersaiAdminMcpConfig } from "./config.js";
import { PersaiOperatorApiError, PersaiOperatorClient } from "./client.js";
import { randomUUID } from "node:crypto";
import { buildSkillActivationSummary, mapChatPlan, summarizeToolSignals } from "./smoke-signals.js";
import {
  buildChatFileUrl,
  mapMessageDeliverable,
  saveAttachmentBytes,
  SMOKE_DELIVERY_AGENT_GUIDE
} from "./chat-deliverables.js";
import {
  assertScenarioScriptInputMapping,
  assertScriptEnvironment,
  assertScriptJsonSchema,
  SCRIPT_WORKING_DIRECTORY_MAX_CHARS
} from "./script-authoring-validation.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Localized text map for Skill.name / Skill.description. At least one locale required;
 * any locale key (2-16 chars) is accepted (API does not require "ru"/"en" specifically here).
 */
const skillLocalizedTextSchema = z
  .record(z.string(), z.string().min(1))
  .describe(
    "Locale map, e.g. { ru: '...', en: '...' }. At least one locale key required (2-16 chars each)."
  );

const skillInstructionCardSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(1200),
  guardrails: z.array(z.string().min(1).max(240)).max(8).optional(),
  examples: z.array(z.string().min(1).max(240)).max(8).optional()
});

const skillUpsertBodySchema = z.object({
  name: skillLocalizedTextSchema,
  description: skillLocalizedTextSchema,
  category: z.string().min(1).max(64),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  instructionCard: skillInstructionCardSchema,
  iconEmoji: z.string().max(16).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  displayOrder: z.number().int().optional(),
  status: z.enum(["draft", "active", "archived"]).optional()
});

/**
 * Skill knowledge card body. NOTE: unlike scenario displayName/description, `title`/`body`
 * here are PLAIN STRINGS (not locale maps) — locale is a separate optional field.
 */
const skillKnowledgeCardBodySchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(80_000),
  locale: z.string().max(16).nullable().optional(),
  tags: z.array(z.string().min(1).max(48)).max(20).optional(),
  lifecycleStatus: z.enum(["draft", "active", "stale", "archived"]).nullable().optional(),
  provenanceKind: z
    .enum(["manual", "assistant_generated", "document_summary", "imported"])
    .optional(),
  provenanceMetadata: z.record(z.string(), z.unknown()).nullable().optional()
});

/**
 * Locale map required by SkillScenario displayName/description. Unlike Skill.name/description,
 * the scenario API strictly REQUIRES both "ru" and "en" keys (validated server-side).
 */
const scenarioLocaleMapSchema = z
  .object({ ru: z.string().min(1).max(500), en: z.string().min(1).max(500) })
  .catchall(z.string().min(1).max(500))
  .describe("Locale map. Both 'ru' and 'en' keys are REQUIRED by the API; other locales allowed.");

/**
 * ADR-151 — Script `key` is immutable and machine-readable, exactly like Role `key`.
 * name/description locale maps strictly require both `ru` and `en` (matches
 * `localizedInput` in apps/api's script-management.types.ts), unlike Skill's
 * any-locale-key map.
 */
const scriptKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{1,63}$/, "must match ^[a-z][a-z0-9_]{1,63}$");

const scriptInputNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/, "must match ^[A-Za-z_][A-Za-z0-9_.-]{0,127}$")
  .refine(
    (name) => !["__proto__", "constructor", "prototype"].includes(name),
    "must not be __proto__, constructor, or prototype"
  );
const scriptInputMappingKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/, "must match ^[A-Za-z_][A-Za-z0-9_.-]{0,127}$")
  .refine(
    (name) => !["__proto__", "constructor", "prototype"].includes(name),
    "must not be __proto__, constructor, or prototype"
  );

/**
 * ADR-151 — a bound Script step reads its inputs only from one of these three
 * sources: an inline literal (JSON value, nesting bounded server-side), the
 * current user message text, or a same-turn tool's prior input by name.
 */
const scenarioScriptInputSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: z.unknown() }).strict(),
  z.object({ source: z.literal("current_user_message") }).strict(),
  z.object({ source: z.literal("tool_input"), name: scriptInputNameSchema }).strict()
]);

/**
 * ADR-151 — binds a Scenario step to a published Script by its stable `scriptKey`
 * (never `scriptId`). `inputMapping` keys are the Script's own `inputSchema`
 * property names (bounded to 32 entries server-side); values describe where
 * each input value comes from at runtime.
 */
const scenarioScriptRefSchema = z
  .object({
    scriptKey: scriptKeySchema,
    inputMapping: z
      .record(scriptInputMappingKeySchema, scenarioScriptInputSourceSchema)
      .superRefine((mapping, context) => {
        try {
          assertScenarioScriptInputMapping(mapping);
        } catch (error) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      })
  })
  .strict();

const scenarioStepSchema = z.object({
  number: z.number().int().nonnegative().describe("1-based step order."),
  directive: z
    .string()
    .min(1)
    .max(600)
    .describe("What the model should do in this step. NOT `title`/`instructions`."),
  recommendedToolCall: z.string().min(1).max(64).nullable().optional(),
  mayBeSkippedIf: z.string().min(1).max(240).nullable().optional(),
  negativeGuards: z.array(z.string().min(1).max(240)).max(8).optional(),
  expectedUserResponse: z.string().min(1).max(400).nullable().optional(),
  nextStepTrigger: z.string().min(1).max(400).nullable().optional(),
  recoveryGuidance: z.string().min(1).max(400).nullable().optional(),
  firstStepPreview: z.string().min(1).max(200).nullable().optional(),
  scriptRef: scenarioScriptRefSchema
    .nullable()
    .optional()
    .describe(
      "Bind this step to a published Script by scriptKey (from script_list/script_get), or omit/null for an ordinary step."
    )
});

export async function resolveAssistantPublishBody(
  client: Pick<PersaiOperatorClient, "requestJson">
): Promise<{ assistantId: string; expectedRoleKey: string; roleKey: string }> {
  const assistantPayload = asRecord(
    await client.requestJson({
      method: "GET",
      path: "/api/v1/assistant"
    })
  );
  const assistant = asRecord(assistantPayload?.assistant);
  const assistantId = typeof assistant?.id === "string" ? assistant.id : null;
  if (assistantId === null) {
    throw new Error("Active assistant id is unavailable.");
  }
  const rolePayload = asRecord(
    await client.requestJson({
      method: "GET",
      path: `/api/v1/assistant/${encodeURIComponent(assistantId)}/role`
    })
  );
  const role = asRecord(rolePayload?.role);
  const roleKey = typeof role?.key === "string" ? role.key : null;
  if (roleKey === null) {
    throw new Error("Active assistant role is unavailable.");
  }
  return {
    assistantId,
    expectedRoleKey: roleKey,
    roleKey
  };
}

const roleNameDescriptionSchema = z
  .object({ ru: z.string().min(1).max(500), en: z.string().min(1).max(500) })
  .strict();
const roleMissionSchema = z
  .object({ ru: z.string().min(1).max(800), en: z.string().min(1).max(800) })
  .strict();

const roleUpsertBodySchema = z
  .object({
    name: roleNameDescriptionSchema,
    description: roleNameDescriptionSchema,
    mission: roleMissionSchema,
    category: z.string().min(1).max(64),
    iconEmoji: z.string().max(16).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    displayOrder: z.number().int().optional(),
    status: z.enum(["draft", "active", "archived"]).optional()
  })
  .strict();
const roleKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{1,63}$/, "must match ^[a-z][a-z0-9_]{1,63}$");
const orderedUniqueSkillIdsSchema = z
  .array(z.string().uuid())
  .refine(
    (skillIds) =>
      new Set(skillIds.map((skillId) => skillId.toLowerCase())).size === skillIds.length,
    {
      message: "skillIds must not contain duplicates"
    }
  );
const orderedUniqueScriptIdsSchema = z
  .array(z.string().uuid())
  .max(100)
  .refine(
    (scriptIds) =>
      new Set(scriptIds.map((scriptId) => scriptId.toLowerCase())).size === scriptIds.length,
    {
      message: "scriptIds must not contain duplicates"
    }
  );

const scriptNameSchema = z
  .object({
    ru: z.string().trim().min(1).max(500),
    en: z.string().trim().min(1).max(500)
  })
  .strict();
const scriptDescriptionSchema = z
  .object({
    ru: z.string().trim().min(1).max(2_000),
    en: z.string().trim().min(1).max(2_000)
  })
  .strict();
const scriptCoreBodySchema = z
  .object({
    name: scriptNameSchema,
    description: scriptDescriptionSchema,
    category: z.string().trim().min(1).max(64),
    icon: z.string().trim().min(1).max(64).nullable(),
    color: z.string().trim().min(1).max(32).nullable(),
    displayOrder: z.number().int().min(-1_000_000).max(1_000_000)
  })
  .strict();
const scriptEnvironmentSchema = z.custom<Record<string, string>>(
  (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    try {
      assertScriptEnvironment(value as Record<string, unknown>);
      return true;
    } catch {
      return false;
    }
  },
  { message: "manifest.environment violates the canonical Script environment contract" }
);
const scriptManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    workingDirectory: z.string().trim().min(1).max(SCRIPT_WORKING_DIRECTORY_MAX_CHARS).nullable(),
    environment: scriptEnvironmentSchema
  })
  .strict();
const scriptJsonSchema = (path: "inputSchema" | "outputSchema") =>
  z.record(z.string(), z.unknown()).superRefine((schema, context) => {
    try {
      assertScriptJsonSchema(schema, path);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
const scriptLimitsSchema = z
  .object({
    timeoutMs: z.number().int().min(100).max(1_800_000),
    maxMemoryMb: z.number().int().min(16).max(32_768),
    maxCpuMillicores: z.number().int().min(10).max(16_000),
    maxOutputBytes: z.number().int().min(1).max(100_000_000)
  })
  .strict();
const scriptVersionBodySchema = z
  .object({
    code: z.string().min(1).max(1_000_000),
    manifest: scriptManifestSchema,
    inputSchema: scriptJsonSchema("inputSchema"),
    outputSchema: scriptJsonSchema("outputSchema"),
    runtime: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_.-]{0,63}$/, "must match ^[a-z][a-z0-9_.-]{0,63}$"),
    entryCommand: z.string().min(1).max(4_096),
    limits: scriptLimitsSchema
  })
  .strict();

export const adminSkillMcpInputSchemas = {
  skillList: z.object({}).strict()
} as const;

export const adminScriptMcpInputSchemas = {
  scriptList: z.object({}).strict(),
  scriptGet: z.object({ scriptKey: scriptKeySchema }).strict(),
  scriptUpsert: z.object({ scriptKey: scriptKeySchema, body: scriptCoreBodySchema }).strict(),
  scriptVersionUpsert: z
    .object({ scriptKey: scriptKeySchema, body: scriptVersionBodySchema })
    .strict(),
  scriptVersionValidate: z.object({ scriptKey: scriptKeySchema }).strict(),
  scriptPublish: z.object({ scriptKey: scriptKeySchema }).strict(),
  scriptArchive: z.object({ scriptKey: scriptKeySchema }).strict(),
  skillScriptsList: z.object({ skillId: z.string().uuid() }).strict(),
  skillScriptsReplace: z
    .object({ skillId: z.string().uuid(), scriptIds: orderedUniqueScriptIdsSchema })
    .strict()
} as const;

export const adminRoleMcpInputSchemas = {
  roleList: z.object({}).strict(),
  roleGet: z.object({ roleKey: roleKeySchema }).strict(),
  roleUpsert: z.object({ roleKey: roleKeySchema, body: roleUpsertBodySchema }).strict(),
  roleSkillsReplace: z
    .object({ roleKey: roleKeySchema, skillIds: orderedUniqueSkillIdsSchema })
    .strict(),
  assistantRoleAssign: z.object({ assistantId: z.string().uuid(), roleKey: roleKeySchema }).strict()
} as const;

type SkillHttpClient = Pick<PersaiOperatorClient, "requestJson">;

export async function requestSkillList(client: SkillHttpClient): Promise<unknown> {
  return client.requestJson({ method: "GET", path: "/api/v1/admin/skills" });
}

export async function resolveAdminRoleIdByKey(
  client: Pick<PersaiOperatorClient, "requestJson">,
  roleKey: string
): Promise<string> {
  const payload = asRecord(
    await client.requestJson({
      method: "GET",
      path: "/api/v1/admin/roles"
    })
  );
  const roles = Array.isArray(payload?.roles) ? payload.roles : [];
  for (const item of roles) {
    const role = asRecord(item);
    if (role !== null && role.key === roleKey && typeof role.id === "string") {
      return role.id;
    }
  }
  throw new Error(`Admin Role key "${roleKey}" was not found.`);
}

type RoleHttpClient = Pick<PersaiOperatorClient, "requestJson">;

export async function requestRoleList(client: RoleHttpClient): Promise<unknown> {
  return client.requestJson({ method: "GET", path: "/api/v1/admin/roles" });
}

export async function requestRoleGet(client: RoleHttpClient, roleKey: string): Promise<unknown> {
  const roleId = await resolveAdminRoleIdByKey(client, roleKey);
  return client.requestJson({ method: "GET", path: `/api/v1/admin/roles/${roleId}` });
}

export async function requestRoleUpsert(
  client: RoleHttpClient,
  roleKey: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const list = asRecord(await requestRoleList(client));
  const roles = Array.isArray(list?.roles) ? list.roles : [];
  const existing = roles
    .map(asRecord)
    .find((role) => role?.key === roleKey && typeof role.id === "string");
  return existing && typeof existing.id === "string"
    ? client.requestJson({
        method: "PATCH",
        path: `/api/v1/admin/roles/${existing.id}`,
        body
      })
    : client.requestJson({
        method: "POST",
        path: "/api/v1/admin/roles",
        body: { key: roleKey, ...body }
      });
}

export async function requestRoleSkillsReplace(
  client: RoleHttpClient,
  roleKey: string,
  skillIds: string[]
): Promise<unknown> {
  const roleId = await resolveAdminRoleIdByKey(client, roleKey);
  return client.requestJson({
    method: "PUT",
    path: `/api/v1/admin/roles/${roleId}/skills`,
    body: { skillIds }
  });
}

export async function requestAssistantRoleAssign(
  client: RoleHttpClient,
  assistantId: string,
  roleKey: string
): Promise<unknown> {
  return client.requestJson({
    method: "PUT",
    path: `/api/v1/assistant/${assistantId}/role`,
    body: { roleKey }
  });
}

type ScriptHttpClient = Pick<PersaiOperatorClient, "requestJson">;

export async function requestScriptList(client: ScriptHttpClient): Promise<unknown> {
  return client.requestJson({ method: "GET", path: "/api/v1/admin/scripts" });
}

async function findAdminScriptByKey(
  client: ScriptHttpClient,
  scriptKey: string
): Promise<Record<string, unknown> | null> {
  const payload = asRecord(await requestScriptList(client));
  const scripts = Array.isArray(payload?.scripts) ? payload.scripts : [];
  for (const item of scripts) {
    const script = asRecord(item);
    if (script !== null && script.key === scriptKey && typeof script.id === "string") {
      return script;
    }
  }
  return null;
}

export async function resolveAdminScriptByKey(
  client: ScriptHttpClient,
  scriptKey: string
): Promise<Record<string, unknown>> {
  const script = await findAdminScriptByKey(client, scriptKey);
  if (script === null) {
    throw new Error(`Script key "${scriptKey}" was not found.`);
  }
  return script;
}

export async function requestScriptGet(
  client: ScriptHttpClient,
  scriptKey: string
): Promise<unknown> {
  const script = await resolveAdminScriptByKey(client, scriptKey);
  const scriptId = script.id as string;
  const [scriptPayload, versionsPayload] = await Promise.all([
    client.requestJson({ method: "GET", path: `/api/v1/admin/scripts/${scriptId}` }),
    client.requestJson({ method: "GET", path: `/api/v1/admin/scripts/${scriptId}/versions` })
  ]);
  return {
    script: asRecord(scriptPayload)?.script ?? null,
    versions: asRecord(versionsPayload)?.versions ?? []
  };
}

export async function requestScriptUpsert(
  client: ScriptHttpClient,
  scriptKey: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const existing = await findAdminScriptByKey(client, scriptKey);
  return existing !== null
    ? client.requestJson({
        method: "PATCH",
        path: `/api/v1/admin/scripts/${existing.id as string}`,
        body
      })
    : client.requestJson({
        method: "POST",
        path: "/api/v1/admin/scripts",
        body: { key: scriptKey, ...body }
      });
}

async function resolveDraftScriptVersion(
  client: ScriptHttpClient,
  scriptId: string
): Promise<Record<string, unknown> | null> {
  const payload = asRecord(
    await client.requestJson({ method: "GET", path: `/api/v1/admin/scripts/${scriptId}/versions` })
  );
  const versions = Array.isArray(payload?.versions) ? payload.versions : [];
  return versions.map(asRecord).find((version) => version?.status === "draft") ?? null;
}

/**
 * Create the Script's first draft version, or update its existing draft with an
 * auto-resolved `expectedRevision` — mirrors `requestRoleUpsert`'s create-vs-update
 * resolution so callers never need to track internal versionId/revision state.
 */
export async function requestScriptVersionUpsert(
  client: ScriptHttpClient,
  scriptKey: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const script = await resolveAdminScriptByKey(client, scriptKey);
  const scriptId = script.id as string;
  const draft = await resolveDraftScriptVersion(client, scriptId);
  return draft && typeof draft.id === "string"
    ? client.requestJson({
        method: "PATCH",
        path: `/api/v1/admin/scripts/${scriptId}/versions/${draft.id}`,
        body: { ...body, expectedRevision: draft.revision }
      })
    : client.requestJson({
        method: "POST",
        path: `/api/v1/admin/scripts/${scriptId}/versions`,
        body
      });
}

export async function requestScriptVersionValidate(
  client: ScriptHttpClient,
  scriptKey: string
): Promise<unknown> {
  const script = await resolveAdminScriptByKey(client, scriptKey);
  const scriptId = script.id as string;
  const draft = await resolveDraftScriptVersion(client, scriptId);
  if (draft === null || typeof draft.id !== "string") {
    throw new Error(`Script "${scriptKey}" has no draft version to validate.`);
  }
  return client.requestJson({
    method: "POST",
    path: `/api/v1/admin/scripts/${scriptId}/versions/${draft.id}/validate`
  });
}

export async function requestScriptPublish(
  client: ScriptHttpClient,
  scriptKey: string
): Promise<unknown> {
  const script = await resolveAdminScriptByKey(client, scriptKey);
  const scriptId = script.id as string;
  const draft = await resolveDraftScriptVersion(client, scriptId);
  if (draft === null || typeof draft.id !== "string") {
    throw new Error(`Script "${scriptKey}" has no draft version to publish.`);
  }
  return client.requestJson({
    method: "POST",
    path: `/api/v1/admin/scripts/${scriptId}/versions/${draft.id}/publish`,
    body: { expectedRevision: draft.revision }
  });
}

export async function requestScriptArchive(
  client: ScriptHttpClient,
  scriptKey: string
): Promise<unknown> {
  const script = await resolveAdminScriptByKey(client, scriptKey);
  return client.requestJson({
    method: "DELETE",
    path: `/api/v1/admin/scripts/${script.id as string}`
  });
}

export async function requestSkillScriptsList(
  client: ScriptHttpClient,
  skillId: string
): Promise<unknown> {
  return client.requestJson({ method: "GET", path: `/api/v1/admin/skills/${skillId}/scripts` });
}

export async function requestSkillScriptsReplace(
  client: ScriptHttpClient,
  skillId: string,
  scriptIds: string[]
): Promise<unknown> {
  return client.requestJson({
    method: "PUT",
    path: `/api/v1/admin/skills/${skillId}/scripts`,
    body: { scriptIds }
  });
}

/**
 * Body shape for POST (create, no top-level scenarioKey arg — `key` required here) and
 * PATCH (update, top-level scenarioKey supplied separately — `key` ignored/not required).
 * Field names deliberately do NOT match the old opaque `z.record(z.unknown())`: there is no
 * `title`/`instructions`/`guardrails`/`triggerIntentExamples` at this level — use
 * `displayName`/`description` (locale maps), `steps[].directive` (not title/instructions),
 * `intentExamples` (not triggerIntentExamples), and `exitCondition` (not guardrails).
 */
const skillScenarioBodySchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/, "lowercase, must start with a letter, underscores allowed")
    .optional()
    .describe("Required when creating (no scenarioKey arg). Ignored/omit on update."),
  displayName: scenarioLocaleMapSchema.optional().describe("Required when creating."),
  description: scenarioLocaleMapSchema.optional().describe("Required when creating."),
  iconEmoji: z.string().max(16).nullable().optional(),
  intentExamples: z.array(z.string().min(1).max(200)).max(10).optional(),
  steps: z
    .array(scenarioStepSchema)
    .min(1)
    .max(20)
    .optional()
    .describe("Required when creating; at least one step."),
  recommendedTools: z.array(z.string().min(1).max(64)).max(12).optional(),
  exitCondition: z
    .string()
    .min(1)
    .max(400)
    .optional()
    .describe("Required when creating. Plain string describing scenario completion."),
  firstStepPreview: z.string().min(1).max(200).nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  displayOrder: z.number().int().nonnegative().optional()
});

function toolText(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

function toolError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (error instanceof PersaiOperatorApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { message: error.message, status: error.status, body: error.body },
            null,
            2
          )
        }
      ]
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

function mapAttachment(attachment: unknown): Record<string, unknown> | null {
  const row = asRecord(attachment);
  if (row === null) {
    return null;
  }
  return {
    id: row.id ?? null,
    path: row.path ?? null,
    mimeType: row.mimeType ?? null,
    originalFilename: row.originalFilename ?? null,
    processingStatus: row.processingStatus ?? null,
    attachmentType: row.attachmentType ?? null,
    documentLink: row.documentLink ?? null
  };
}

function mapMessage(message: unknown): Record<string, unknown> | null {
  const row = asRecord(message);
  if (row === null) {
    return null;
  }
  const attachments = Array.isArray(row.attachments)
    ? row.attachments
        .map((item) => mapAttachment(item))
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
  return {
    id: row.id ?? null,
    content: row.content ?? "",
    attachments,
    toolInvocations: row.toolInvocations ?? [],
    workingNotes: row.workingNotes ?? []
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPersaiAdminMcpServer(
  config: PersaiAdminMcpConfig,
  client: PersaiOperatorClient = new PersaiOperatorClient(config)
): McpServer {
  const server = new McpServer({
    name: "persai-admin-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "skill_list",
    {
      description:
        "List all canonical admin Skills with their IDs and current metadata via GET /api/v1/admin/skills. Use this before skill_get, Role composition, or catalog migration.",
      inputSchema: adminSkillMcpInputSchemas.skillList
    },
    async () => {
      try {
        const payload = await requestSkillList(client);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_upsert",
    {
      description:
        "Create or update an admin Skill (core fields + instructionCard). Pass skillId to update.",
      inputSchema: z.object({
        skillId: z.string().uuid().optional(),
        body: skillUpsertBodySchema
      })
    },
    async ({ skillId, body }) => {
      try {
        const payload =
          skillId === undefined
            ? await client.requestJson({ method: "POST", path: "/api/v1/admin/skills", body })
            : await client.requestJson({
                method: "PATCH",
                path: `/api/v1/admin/skills/${skillId}`,
                body
              });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_get",
    {
      description: "Fetch a Skill with documents, knowledge cards, and scenarios.",
      inputSchema: z.object({ skillId: z.string().uuid() })
    },
    async ({ skillId }) => {
      try {
        const [skill, scenarios] = await Promise.all([
          client.requestJson({ method: "GET", path: `/api/v1/admin/skills/${skillId}` }),
          client.requestJson({
            method: "GET",
            path: `/api/v1/admin/skills/${skillId}/scenarios`
          })
        ]);
        return toolText({ skill, scenarios });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_card_upsert",
    {
      description:
        "Create or update a Skill knowledge card. `title`/`body` are plain strings (locale is a separate optional field) — NOT locale maps. Defaults provenanceKind=manual when omitted in body.",
      inputSchema: z.object({
        skillId: z.string().uuid(),
        cardId: z.string().uuid().optional(),
        body: skillKnowledgeCardBodySchema
      })
    },
    async ({ skillId, cardId, body }) => {
      try {
        const requestBody = {
          provenanceKind: "manual",
          ...body
        };
        const payload =
          cardId === undefined
            ? await client.requestJson({
                method: "POST",
                path: `/api/v1/admin/skills/${skillId}/knowledge-cards`,
                body: requestBody
              })
            : await client.requestJson({
                method: "PATCH",
                path: `/api/v1/admin/skills/${skillId}/knowledge-cards/${cardId}`,
                body: requestBody
              });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_document_upload",
    {
      description: "Upload a PDF or document file to a Skill knowledge base.",
      inputSchema: z.object({
        skillId: z.string().uuid(),
        filePath: z.string().min(1),
        displayName: z.string().optional(),
        description: z.string().optional()
      })
    },
    async ({ skillId, filePath, displayName, description }) => {
      try {
        const payload = await client.uploadSkillDocument({
          skillId,
          filePath,
          displayName: displayName ?? null,
          description: description ?? null
        });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_scenario_upsert",
    {
      description:
        "Create (omit scenarioKey) or update (pass scenarioKey) a Skill scenario. Body uses `key`/`displayName`+`description` (locale maps, both ru+en required)/`steps[].directive`/`exitCondition` — NOT `scenarioKey`-in-body/`title`/`instructions`/`guardrails`/`triggerIntentExamples`.",
      inputSchema: z.object({
        skillId: z.string().uuid(),
        scenarioKey: z
          .string()
          .optional()
          .describe("Omit to CREATE (POST); pass the existing key to UPDATE (PATCH)."),
        body: skillScenarioBodySchema
      })
    },
    async ({ skillId, scenarioKey, body }) => {
      try {
        const payload =
          scenarioKey === undefined
            ? await client.requestJson({
                method: "POST",
                path: `/api/v1/admin/skills/${skillId}/scenarios`,
                body
              })
            : await client.requestJson({
                method: "PATCH",
                path: `/api/v1/admin/skills/${skillId}/scenarios/${scenarioKey}`,
                body
              });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "indexing_wait",
    {
      description:
        "Poll knowledge indexing jobs until completed/failed or timeout. Provide jobIds and/or skillId.",
      inputSchema: z.object({
        jobIds: z.array(z.string().uuid()).optional(),
        skillId: z.string().uuid().optional(),
        timeoutMs: z.number().int().positive().optional()
      })
    },
    async ({ jobIds, skillId, timeoutMs }) => {
      try {
        const pending = new Set(jobIds ?? []);
        if (pending.size === 0 && skillId === undefined) {
          throw new Error("Provide at least one jobId or skillId.");
        }

        const deadline = Date.now() + (timeoutMs ?? config.indexingTimeoutMs);
        const snapshots: unknown[] = [];

        while (Date.now() < deadline) {
          const jobsPayload = await client.requestJson({
            method: "GET",
            path: "/api/v1/admin/knowledge-indexing/jobs"
          });
          const jobsRow = asRecord(jobsPayload);
          const jobs = Array.isArray(jobsRow?.jobs) ? jobsRow.jobs : [];

          let skillReady = skillId === undefined;
          let skillFailedItems: unknown[] = [];
          if (skillId !== undefined) {
            const skillPayload = await client.requestJson({
              method: "GET",
              path: `/api/v1/admin/skills/${skillId}`
            });
            snapshots.push(skillPayload);
            const skillRow = asRecord(skillPayload);
            const skill = asRecord(skillRow?.skill);
            const documents = Array.isArray(skill?.documents) ? skill.documents : [];
            const cards = Array.isArray(skill?.knowledgeCards) ? skill.knowledgeCards : [];
            const isFailedStatus = (status: unknown) => {
              const normalized = String(status ?? "");
              return normalized === "failed" || normalized === "needs_review";
            };
            skillFailedItems = [...documents, ...cards].filter((item) =>
              isFailedStatus(asRecord(item)?.status)
            );
            const docProcessing = documents.some((item) => asRecord(item)?.status === "processing");
            const cardProcessing = cards.some((item) => asRecord(item)?.status === "processing");
            skillReady = skillFailedItems.length === 0 && !docProcessing && !cardProcessing;
          }

          if (skillFailedItems.length > 0) {
            return toolText({
              ready: false,
              skillFailed: true,
              failedItems: skillFailedItems,
              skillId
            });
          }

          const trackedJobs =
            pending.size > 0
              ? jobs.filter((job) => pending.has(String(asRecord(job)?.id ?? "")))
              : [];

          const trackedJobIds = new Set(trackedJobs.map((job) => String(asRecord(job)?.id ?? "")));
          const missingJobIds = [...pending].filter((jobId) => !trackedJobIds.has(jobId));

          const incomplete = trackedJobs.filter((job) => {
            const status = String(asRecord(job)?.status ?? "");
            return status !== "completed" && status !== "failed" && status !== "cancelled";
          });

          const jobsReady =
            pending.size === 0 || (missingJobIds.length === 0 && incomplete.length === 0);
          if (jobsReady && skillReady) {
            return toolText({
              ready: true,
              jobs: trackedJobs,
              skillId: skillId ?? null
            });
          }

          const failed = trackedJobs.filter(
            (job) => asRecord(job)?.status === "failed" || asRecord(job)?.status === "needs_review"
          );
          if (failed.length > 0) {
            return toolText({ ready: false, failed, jobs: trackedJobs });
          }

          await sleep(config.indexingPollIntervalMs);
        }

        return toolText({
          ready: false,
          timedOut: true,
          jobIds: [...pending],
          skillId: skillId ?? null,
          lastSnapshots: snapshots.slice(-1),
          note:
            pending.size > 0
              ? "Some jobIds may be outside the admin jobs list page; retry with skillId or wait for list visibility."
              : null
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "script_list",
    {
      description: "List all platform-global reusable Scripts via GET /api/v1/admin/scripts.",
      inputSchema: adminScriptMcpInputSchemas.scriptList
    },
    async () => {
      try {
        const payload = await requestScriptList(client);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "script_get",
    {
      description:
        "Fetch one Script by immutable scriptKey with its full ScriptVersion history (draft + published).",
      inputSchema: adminScriptMcpInputSchemas.scriptGet
    },
    async ({ scriptKey }) => {
      try {
        const payload = await requestScriptGet(client, scriptKey);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "script_upsert",
    {
      description:
        "Create or update a Script's core metadata (name/description/category/icon/color/displayOrder) by immutable scriptKey. Create uses POST /admin/scripts; update resolves scriptId then PATCH /admin/scripts/{scriptId}. Does not touch code/manifest/schemas — use script_version_upsert for that.",
      inputSchema: adminScriptMcpInputSchemas.scriptUpsert
    },
    async ({ scriptKey, body }) => {
      try {
        const payload = await requestScriptUpsert(client, scriptKey, body);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "script_version_upsert",
    {
      description:
        "Author a Script's draft ScriptVersion (code/manifest/inputSchema/outputSchema/runtime/entryCommand/limits) by scriptKey. Creates the first draft if none exists, or updates the existing draft with an auto-resolved expectedRevision. Published versions are immutable — this never touches them.",
      inputSchema: adminScriptMcpInputSchemas.scriptVersionUpsert
    },
    async ({ scriptKey, body }) => {
      try {
        const payload = await requestScriptVersionUpsert(client, scriptKey, body);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "script_version_validate",
    {
      description:
        "Validate a Script's current draft ScriptVersion executable contract (JSON Schema Draft 2020-12 input/output, manifest, limits) without publishing it.",
      inputSchema: adminScriptMcpInputSchemas.scriptVersionValidate
    },
    async ({ scriptKey }) => {
      try {
        const payload = await requestScriptVersionValidate(client, scriptKey);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "script_publish",
    {
      description:
        "Publish a Script's current draft ScriptVersion by scriptKey (auto-resolves versionId/expectedRevision). The published version becomes permanently immutable.",
      inputSchema: adminScriptMcpInputSchemas.scriptPublish
    },
    async ({ scriptKey }) => {
      try {
        const payload = await requestScriptPublish(client, scriptKey);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "script_archive",
    {
      description:
        "Archive a Script by scriptKey via DELETE /admin/scripts/{scriptId}. Fails with admin_script_in_use while a live Skill or Scenario references it.",
      inputSchema: adminScriptMcpInputSchemas.scriptArchive
    },
    async ({ scriptKey }) => {
      try {
        const payload = await requestScriptArchive(client, scriptKey);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_scripts_list",
    {
      description:
        "List a Skill's full ordered list of linked (published) Scripts via GET /admin/skills/{skillId}/scripts.",
      inputSchema: adminScriptMcpInputSchemas.skillScriptsList
    },
    async ({ skillId }) => {
      try {
        const payload = await requestSkillScriptsList(client, skillId);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_scripts_replace",
    {
      description:
        "Full-replace a Skill's ordered list of linked Scripts via PUT /admin/skills/{skillId}/scripts. Never merges — pass the complete desired scriptIds order. All scriptIds must reference published Scripts.",
      inputSchema: adminScriptMcpInputSchemas.skillScriptsReplace
    },
    async ({ skillId, scriptIds }) => {
      try {
        const payload = await requestSkillScriptsReplace(client, skillId, scriptIds);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "role_list",
    {
      description: "List admin Assistant Roles via GET /api/v1/admin/roles.",
      inputSchema: adminRoleMcpInputSchemas.roleList
    },
    async () => {
      try {
        const payload = await requestRoleList(client);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "role_get",
    {
      description:
        "Fetch one admin Assistant Role by immutable roleKey. Resolves roleId via GET /api/v1/admin/roles then GET /api/v1/admin/roles/{roleId}.",
      inputSchema: adminRoleMcpInputSchemas.roleGet
    },
    async ({ roleKey }) => {
      try {
        const payload = await requestRoleGet(client, roleKey);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "role_upsert",
    {
      description:
        "Create or update an admin Assistant Role by immutable roleKey. Create uses POST /admin/roles; update resolves roleId then PATCH /admin/roles/{roleId}. Key is immutable.",
      inputSchema: adminRoleMcpInputSchemas.roleUpsert
    },
    async ({ roleKey, body }) => {
      try {
        const payload = await requestRoleUpsert(client, roleKey, body);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "role_skills_replace",
    {
      description:
        "Full-replace ordered Skills for an Assistant Role by roleKey via PUT /api/v1/admin/roles/{roleId}/skills. Never merges.",
      inputSchema: adminRoleMcpInputSchemas.roleSkillsReplace
    },
    async ({ roleKey, skillIds }) => {
      try {
        const payload = await requestRoleSkillsReplace(client, roleKey, skillIds);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "assistant_role_assign",
    {
      description:
        "Assign an Assistant Role by exact assistantId + immutable roleKey via PUT /api/v1/assistant/{assistantId}/role.",
      inputSchema: adminRoleMcpInputSchemas.assistantRoleAssign
    },
    async ({ assistantId, roleKey }) => {
      try {
        const payload = await requestAssistantRoleAssign(client, assistantId, roleKey);
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "assistant_publish",
    {
      description: "Publish the active assistant draft and materialize the runtime bundle.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const body = await resolveAssistantPublishBody(client);
        const payload = await client.requestJson({
          method: "POST",
          path: "/api/v1/assistant/publish",
          body
        });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_stage_attachment",
    {
      description:
        "Stage a local file for the next web chat turn (same clientTurnId as chat_smoke).",
      inputSchema: z.object({
        surfaceThreadKey: z.string().min(1),
        clientTurnId: z.string().min(1),
        filePath: z.string().min(1),
        clientAttachmentId: z.string().optional()
      })
    },
    async ({ surfaceThreadKey, clientTurnId, filePath, clientAttachmentId }) => {
      try {
        const payload = await client.uploadChatStageAttachment({
          surfaceThreadKey,
          clientTurnId,
          filePath,
          clientAttachmentId: clientAttachmentId ?? null
        });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_list_deliverables",
    {
      description:
        "List recent web chat messages with attachments and active media/document jobs. Use after async delivery.",
      inputSchema: z.object({
        chatId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional()
      })
    },
    async ({ chatId, limit }) => {
      try {
        const query = `?limit=${String(limit ?? 30)}`;
        const payload = await client.requestJson({
          method: "GET",
          path: `/api/v1/assistant/chats/web/${chatId}/messages${query}`
        });
        const row = asRecord(payload);
        const messages = Array.isArray(row?.messages) ? row.messages : [];
        const deliverables = messages
          .map((item) => mapMessageDeliverable(item))
          .filter((item): item is Record<string, unknown> => item !== null);
        const withAttachments = deliverables.filter(
          (message) =>
            Array.isArray(message.attachments) && (message.attachments as unknown[]).length > 0
        );
        return toolText({
          chatId,
          agentGuide: SMOKE_DELIVERY_AGENT_GUIDE,
          currentEngagement: row?.currentEngagement ?? null,
          activeMediaJobs: row?.activeMediaJobs ?? [],
          activeDocumentJobs: row?.activeDocumentJobs ?? [],
          messages: deliverables,
          attachmentMessages: withAttachments,
          nextStep:
            withAttachments.length > 0
              ? "Call chat_inspect_attachments(chatId) to save full files for vision QA."
              : row?.activeMediaJobs && (row.activeMediaJobs as unknown[]).length > 0
                ? "Media still running — poll chat_list_deliverables again."
                : "No attachments yet."
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_inspect_attachments",
    {
      description:
        "Download full chat attachments to local disk for Cursor Read/vision QA. Best for scenario slide checks.",
      inputSchema: z.object({
        chatId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional(),
        paths: z.array(z.string().min(1)).optional()
      })
    },
    async ({ chatId, limit, paths }) => {
      try {
        const query = limit !== undefined ? `?limit=${String(limit)}` : "?limit=30";
        const payload = await client.requestJson({
          method: "GET",
          path: `/api/v1/assistant/chats/web/${chatId}/messages${query}`
        });
        const row = asRecord(payload);
        const messages = Array.isArray(row?.messages) ? row.messages : [];
        const pathFilter = paths !== undefined ? new Set(paths) : null;
        const inspected: Record<string, unknown>[] = [];

        for (const message of messages) {
          const messageRow = asRecord(message);
          if (messageRow === null || messageRow.author !== "assistant") {
            continue;
          }
          const attachments = Array.isArray(messageRow.attachments) ? messageRow.attachments : [];
          for (const attachment of attachments) {
            const attachmentRow = asRecord(attachment);
            if (attachmentRow === null) {
              continue;
            }
            const storagePath = String(attachmentRow.path ?? "");
            if (storagePath.length === 0) {
              continue;
            }
            if (pathFilter !== null && !pathFilter.has(storagePath)) {
              continue;
            }
            const attachmentId = String(attachmentRow.id ?? randomUUID());
            const { buffer, contentType } = await client.requestBinary({
              path: buildChatFileUrl({ chatId, path: storagePath, variant: "full" })
            });
            const truncated = buffer.length > config.attachmentFetchMaxBytes;
            const localPath = await saveAttachmentBytes({
              artifactRoot: config.artifactDir,
              chatId,
              attachmentId,
              buffer: truncated ? buffer.subarray(0, config.attachmentFetchMaxBytes) : buffer,
              mimeType: contentType,
              originalFilename:
                typeof attachmentRow.originalFilename === "string"
                  ? attachmentRow.originalFilename
                  : null
            });
            inspected.push({
              messageId: messageRow.id ?? null,
              attachmentId,
              path: storagePath,
              mimeType: contentType,
              sizeBytes: buffer.length,
              truncated,
              localPath,
              visionHint:
                "Open localPath with the Read tool to visually verify image/slide content."
            });
          }
        }

        return toolText({
          chatId,
          artifactDir: config.artifactDir,
          inspected,
          agentGuide: SMOKE_DELIVERY_AGENT_GUIDE,
          nextStep:
            inspected.length > 0
              ? "Read each localPath and compare to scenario goal (copy on slides, layout, count)."
              : "No attachments found — try chat_list_deliverables or wait for media jobs."
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_fetch_attachment",
    {
      description:
        "Download one chat file. Prefer variant=full + saveLocally for smoke vision QA; preview is a small webp thumb.",
      inputSchema: z.object({
        chatId: z.string().uuid(),
        path: z.string().min(1),
        variant: z.enum(["preview", "full"]).optional(),
        saveLocally: z.boolean().optional(),
        attachmentId: z.string().optional()
      })
    },
    async ({ chatId, path, variant, saveLocally, attachmentId }) => {
      try {
        const resolvedVariant = variant ?? "full";
        const shouldSave = saveLocally ?? true;
        const { buffer, contentType } = await client.requestBinary({
          path: buildChatFileUrl({ chatId, path, variant: resolvedVariant })
        });
        const truncated = buffer.length > config.attachmentFetchMaxBytes;
        const slice = truncated ? buffer.subarray(0, config.attachmentFetchMaxBytes) : buffer;
        let localPath: string | null = null;
        if (shouldSave) {
          localPath = await saveAttachmentBytes({
            artifactRoot: config.artifactDir,
            chatId,
            attachmentId: attachmentId ?? randomUUID(),
            buffer: slice,
            mimeType: contentType,
            originalFilename: null
          });
        }
        return toolText({
          chatId,
          path,
          variant: resolvedVariant,
          contentType,
          sizeBytes: buffer.length,
          truncated,
          localPath,
          visionHint:
            localPath !== null ? "Open localPath with Read for vision verification." : null,
          base64: shouldSave ? null : slice.toString("base64")
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_smoke",
    {
      description:
        "Send a sync web chat turn. Returns skill/scenario activation, todo plan, and tool signals for smoke evaluation.",
      inputSchema: z.object({
        message: z.string().min(1),
        surfaceThreadKey: z.string().min(1).optional(),
        clientTurnId: z.string().min(1).optional(),
        attachmentPaths: z.array(z.string().min(1)).optional(),
        goal: z.string().optional()
      })
    },
    async ({ message, surfaceThreadKey, clientTurnId, attachmentPaths, goal }) => {
      try {
        const threadKey = surfaceThreadKey ?? `mcp-smoke-${randomUUID()}`;
        const turnId = clientTurnId ?? randomUUID();
        const staged: unknown[] = [];

        if (attachmentPaths !== undefined) {
          for (const filePath of attachmentPaths) {
            staged.push(
              await client.uploadChatStageAttachment({
                surfaceThreadKey: threadKey,
                clientTurnId: turnId,
                filePath
              })
            );
          }
        }

        const payload = await client.requestJson({
          method: "POST",
          path: "/api/v1/assistant/chat/web",
          timeoutMs: config.chatTimeoutMs,
          body: {
            surfaceThreadKey: threadKey,
            message,
            clientTurnId: turnId
          }
        });

        const root = asRecord(payload);
        const transport = asRecord(root?.transport);
        const chat = asRecord(transport?.chat);
        const assistantMessage = mapMessage(transport?.assistantMessage);
        const chatId = typeof chat?.id === "string" ? chat.id : null;

        let plan: Record<string, unknown> | null = null;
        if (chatId !== null) {
          try {
            const planPayload = await client.requestJson({
              method: "GET",
              path: `/api/v1/assistant/chats/web/${chatId}/plan`
            });
            plan = mapChatPlan(planPayload);
          } catch (planError) {
            plan = {
              fetchError: planError instanceof Error ? planError.message : String(planError)
            };
          }
        }

        const toolSignals = summarizeToolSignals(assistantMessage?.toolInvocations);
        const skillActivation = buildSkillActivationSummary(transport, chat);
        const activeMediaJobs = Array.isArray(transport?.activeMediaJobs)
          ? transport.activeMediaJobs
          : [];
        const activeDocumentJobs = Array.isArray(transport?.activeDocumentJobs)
          ? transport.activeDocumentJobs
          : [];
        const mediaToolRequested =
          toolSignals.other.some((tool) => {
            const name = String(asRecord(tool)?.name ?? "");
            return (
              name === "image_generate" ||
              name === "image_edit" ||
              name === "video_generate" ||
              name === "document"
            );
          }) ||
          activeMediaJobs.length > 0 ||
          activeDocumentJobs.length > 0;

        const result = {
          goal: goal ?? null,
          thread: {
            surfaceThreadKey: threadKey,
            chatId,
            clientTurnId: turnId
          },
          stagedAttachments: staged,
          userMessage: mapMessage(transport?.userMessage),
          assistantMessage,
          skillActivation,
          toolSignals,
          plan,
          skillState: chat?.skillDecisionState ?? null,
          engagementSummary: transport?.engagementSummary ?? null,
          turnRouting: asRecord(transport?.runtime)?.turnRouting ?? null,
          activeMediaJobs,
          activeDocumentJobs,
          pendingDelivery: activeMediaJobs.length > 0 || activeDocumentJobs.length > 0,
          deliveryCheck: mediaToolRequested
            ? {
                agentGuide: SMOKE_DELIVERY_AGENT_GUIDE,
                nextTools: ["chat_list_deliverables", "chat_inspect_attachments"],
                note: "Async delivery matches web UI. Poll chat_list_deliverables until attachmentMessages appear, then chat_inspect_attachments and Read localPath for vision QA."
              }
            : null,
          evaluationHint:
            "Workflow: skillActivation + plan.todos on turn; if deliveryCheck set, inspect attachments before PASS/FAIL."
        };

        return toolText(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}
