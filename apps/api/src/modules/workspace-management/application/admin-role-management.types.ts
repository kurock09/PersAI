import type { AssistantRole, AssistantRoleSkill, Skill } from "@prisma/client";

export type AdminRoleStatus = "draft" | "active" | "archived";
export type AdminRoleLocalizedText = {
  ru: string;
  en: string;
};

export type AdminRoleUpsertInput = {
  key: string | null;
  name: AdminRoleLocalizedText;
  description: AdminRoleLocalizedText;
  mission: AdminRoleLocalizedText;
  category: string;
  iconEmoji: string | null;
  color: string | null;
  displayOrder: number | null;
  status: AdminRoleStatus | null;
};

export type AdminRoleSkillLinkState = {
  skillId: string;
  displayOrder: number;
  createdAt: string;
  skill: {
    id: string;
    status: "draft" | "active" | "archived";
    name: Record<string, string>;
    description: Record<string, string>;
    category: string;
    iconEmoji: string | null;
    color: string | null;
  };
};

export type AdminRoleState = {
  id: string;
  key: string;
  name: AdminRoleLocalizedText;
  description: AdminRoleLocalizedText;
  mission: AdminRoleLocalizedText;
  category: string;
  iconEmoji: string | null;
  color: string | null;
  status: AdminRoleStatus;
  displayOrder: number;
  isDefault: boolean;
  assistantCount: number;
  inUse: boolean;
  skillIds: string[];
  skills: AdminRoleSkillLinkState[];
  createdAt: string;
  updatedAt: string;
};

export type AdminRolePreviewInput = {
  locale: "en" | "ru";
  mission: AdminRoleLocalizedText;
  skillIds: string[];
};

export type AdminRolePreviewState = {
  locale: "en" | "ru";
  missionBlock: string;
  enabledSkillsBlock: string;
  skillIds: string[];
};

export type AdminRoleSkillsReplaceInput = {
  skillIds: string[];
};

const MAX_LOCALIZED_TEXT_CHARS = 500;
const MAX_MISSION_CHARS = 800;
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORE_KEYS = [
  "name",
  "description",
  "mission",
  "category",
  "iconEmoji",
  "color",
  "displayOrder",
  "status"
] as const;

export function parseAdminRoleCreateInput(body: unknown): AdminRoleUpsertInput {
  const row = asObject(body, "Request body");
  assertExactKeys(row, ["key", ...CORE_KEYS], "Request body");
  const key = parseRoleKey(row.key, "key");
  return {
    key,
    ...parseAdminRoleCoreFields(row)
  };
}

export function parseAdminRoleUpdateInput(body: unknown): AdminRoleUpsertInput {
  const row = asObject(body, "Request body");
  assertExactKeys(row, CORE_KEYS, "Request body");
  return {
    key: null,
    ...parseAdminRoleCoreFields(row)
  };
}

export function parseAdminRolePreviewInput(body: unknown): AdminRolePreviewInput {
  const row = asObject(body, "Request body");
  assertExactKeys(row, ["locale", "mission", "skillIds"], "Request body");
  const locale = row.locale;
  if (locale !== "en" && locale !== "ru") {
    throw new Error('locale must be "en" or "ru".');
  }
  return {
    locale,
    mission: parseRequiredLocalizedText(row.mission, "mission", MAX_MISSION_CHARS),
    skillIds: parseOrderedSkillIds(row.skillIds)
  };
}

export function parseAdminRoleSkillsReplaceInput(body: unknown): AdminRoleSkillsReplaceInput {
  const row = asObject(body, "Request body");
  assertExactKeys(row, ["skillIds"], "Request body");
  return {
    skillIds: parseOrderedSkillIds(row.skillIds)
  };
}

export function toAdminRoleState(
  role: AssistantRole & {
    skillLinks?: Array<AssistantRoleSkill & { skill?: Skill | null }>;
    _count?: { assistants: number };
  },
  defaultRoleKey: string
): AdminRoleState {
  const links = [...(role.skillLinks ?? [])].sort((left, right) => {
    if (left.displayOrder !== right.displayOrder) {
      return left.displayOrder - right.displayOrder;
    }
    return left.skillId.localeCompare(right.skillId);
  });
  return {
    id: role.id,
    key: role.key,
    name: normalizeRequiredRoleLocalizedTextState(role.name),
    description: normalizeRequiredRoleLocalizedTextState(role.description),
    mission: normalizeRequiredRoleLocalizedTextState(role.mission),
    category: role.category,
    iconEmoji: role.iconEmoji,
    color: role.color,
    status: role.status,
    displayOrder: role.displayOrder,
    isDefault: role.key === defaultRoleKey,
    assistantCount: role._count?.assistants ?? 0,
    inUse: (role._count?.assistants ?? 0) > 0,
    skillIds: links.map((link) => link.skillId),
    skills: links.map((link) => ({
      skillId: link.skillId,
      displayOrder: link.displayOrder,
      createdAt: link.createdAt.toISOString(),
      skill: {
        id: link.skill?.id ?? link.skillId,
        status: link.skill?.status ?? "archived",
        name: normalizeLocalizedTextState(link.skill?.name),
        description: normalizeLocalizedTextState(link.skill?.description),
        category: link.skill?.category ?? "",
        iconEmoji: link.skill?.iconEmoji ?? null,
        color: link.skill?.color ?? null
      }
    })),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString()
  };
}

function parseAdminRoleCoreFields(row: Record<string, unknown>): Omit<AdminRoleUpsertInput, "key"> {
  return {
    name: parseRequiredLocalizedText(row.name, "name", MAX_LOCALIZED_TEXT_CHARS),
    description: parseRequiredLocalizedText(
      row.description,
      "description",
      MAX_LOCALIZED_TEXT_CHARS
    ),
    mission: parseRequiredLocalizedText(row.mission, "mission", MAX_MISSION_CHARS),
    category: parseBoundedString(row.category, "category", 1, 64),
    iconEmoji: parseNullableBoundedString(row.iconEmoji, "iconEmoji", 16),
    color: parseNullableBoundedString(row.color, "color", 32),
    displayOrder: parseNullableInteger(row.displayOrder, "displayOrder"),
    status: parseNullableStatus(row.status, "status")
  };
}

function parseRoleKey(value: unknown, path: string): string {
  const key = parseBoundedString(value, path, 2, 64);
  if (!ROLE_KEY_PATTERN.test(key)) {
    throw new Error(
      `${path} must match ^[a-z][a-z0-9_]{1,63}$ (lowercase letter start, then letters/digits/underscores).`
    );
  }
  return key;
}

function parseRequiredLocalizedText(
  value: unknown,
  path: string,
  maxChars: number
): AdminRoleLocalizedText {
  const row = asObject(value, path);
  assertExactKeys(row, ["ru", "en"], path);
  return {
    ru: parseBoundedString(row.ru, `${path}.ru`, 1, maxChars),
    en: parseBoundedString(row.en, `${path}.en`, 1, maxChars)
  };
}

function parseOrderedSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("skillIds must be an array.");
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !UUID_PATTERN.test(item.trim())) {
      throw new Error("skillIds must contain valid UUIDs.");
    }
    const skillId = item.trim();
    const dedupeKey = skillId.toLowerCase();
    if (seen.has(dedupeKey)) {
      throw new Error("skillIds must not contain duplicates.");
    }
    seen.add(dedupeKey);
    ordered.push(skillId);
  }
  return ordered;
}

function parseNullableStatus(value: unknown, path: string): AdminRoleStatus | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "draft" || value === "active" || value === "archived") {
    return value;
  }
  throw new Error(`${path} must be draft, active, or archived.`);
}

function parseNullableInteger(value: unknown, path: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${path} must be an integer.`);
  }
  return value as number;
}

function parseNullableBoundedString(value: unknown, path: string, maxChars: number): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseBoundedString(value, path, 1, maxChars);
}

function parseBoundedString(
  value: unknown,
  path: string,
  minChars: number,
  maxChars: number
): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minChars || trimmed.length > maxChars) {
    throw new Error(`${path} must be between ${String(minChars)} and ${String(maxChars)} chars.`);
  }
  if (containsControlCharacters(trimmed)) {
    throw new Error(`${path} contains invalid control characters.`);
  }
  return trimmed;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  row: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(row).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${path} contains unknown field(s): ${unknown.sort().join(", ")}.`);
  }
}

function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || (code >= 0x7f && code <= 0x9f))) {
      return true;
    }
  }
  return false;
}

function normalizeLocalizedTextState(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, textValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof textValue === "string") {
      result[key] = textValue;
    }
  }
  return result;
}

function normalizeRequiredRoleLocalizedTextState(value: unknown): AdminRoleLocalizedText {
  const normalized = Object.fromEntries(
    Object.entries(normalizeLocalizedTextState(value)).map(([key, text]) => [
      key.trim().toLowerCase(),
      text
    ])
  );
  return {
    ru: normalized.ru ?? "",
    en: normalized.en ?? ""
  };
}
