"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Check,
  CheckCircle,
  Copy,
  Eye,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Wrench
} from "lucide-react";
import { cn } from "@/app/lib/utils";

interface PromptTemplateState {
  id: string;
  template: string;
  updatedAt: string;
}

interface PersonaArchetypeAdminState {
  key: string;
  displayOrder: number;
  label: { ru: string; en: string };
  description: { ru: string; en: string };
  voice: {
    sentenceLength: "short" | "medium" | "long";
    pace: "slow" | "normal" | "quick";
    irony: number;
  };
  openingsAllowed: { ru: string[]; en: string[] };
  openingsForbidden: { ru: string[]; en: string[] };
  behaviors: {
    whenUserUpset: { ru: string; en: string };
    whenUserExcited: { ru: string; en: string };
    whenUserTired: { ru: string; en: string };
    whenUserAngry: { ru: string; en: string };
  };
  silenceRule: { ru: string; en: string };
  examples: Array<{
    context: { ru: string; en: string };
    reply: { ru: string; en: string };
  }>;
  defaultTraits: Record<string, number>;
  updatedAt: string;
}

interface ToolPromptState {
  toolCode: string;
  displayName: string;
  description: string | null;
  modelDescription: string | null;
  modelUsageGuidance: string | null;
  toolClass: "cost_driving" | "utility";
  capabilityGroup: "knowledge" | "automation" | "communication" | "workspace_ops";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  catalogStatus: "active" | "inactive";
}

const SYSTEM_TEMPLATE_IDS = ["system"] as const;
const ORDINARY_TEMPLATE_IDS = ["soul", "user", "identity", "tools", "agents", "heartbeat"] as const;
const ROUTER_TEMPLATE_IDS = ["router_classifier"] as const;
const ONBOARDING_TEMPLATE_IDS = ["preview_bootstrap", "welcome_bootstrap"] as const;
const PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER = [
  "summarize_context",
  "compact_context",
  "memory_write",
  "quota_status",
  "knowledge_search",
  "knowledge_fetch",
  "web_search",
  "web_fetch",
  "browser",
  "image_generate",
  "image_edit",
  "video_generate",
  "tts",
  "scheduled_action",
  "files",
  "exec",
  "shell"
] as const;
const PROMPT_CONSTRUCTOR_MODEL_TOOL_SET = new Set<string>(PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER);

const PRESET_META: Record<
  string,
  {
    label: string;
    description: string;
    variables: Array<{ key: string; hint: string }>;
  }
> = {
  system: {
    label: "System Prompt Assembly",
    description:
      "The real ordinary-turn assembly order. Reorder, remove, or repeat blocks here to control the compiled system prompt directly.",
    variables: [
      { key: "assistant_identity_block", hint: "Assistant display-name line" },
      { key: "user_identity_block", hint: "User display-name line" },
      { key: "locale_block", hint: "User locale line" },
      { key: "timezone_block", hint: "User timezone line" },
      { key: "persona_instructions_block", hint: "Published assistant instructions block" },
      { key: "soul_block", hint: "Compiled soul prompt block" },
      { key: "user_block", hint: "Compiled user-context block" },
      { key: "identity_block", hint: "Compiled identity block" },
      { key: "tools_block", hint: "Compiled native tool runtime block" },
      { key: "agents_block", hint: "Compiled memory and task governance block" },
      { key: "heartbeat_block", hint: "Compiled task heartbeat block" }
    ]
  },
  soul: {
    label: "Core Persona",
    description: "Assistant persona, traits, and explicit instructions.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "assistant_gender_line", hint: "Optional assistant gender line" },
      { key: "traits_block", hint: "Generated personality traits summary" },
      { key: "instructions_block", hint: "Explicit user-owned instructions block" }
    ]
  },
  user: {
    label: "User Context",
    description: "Structured human context available during ordinary turns.",
    variables: [
      { key: "user_name_line", hint: "User display name line" },
      { key: "user_birthday_line", hint: "User birthday line" },
      { key: "user_gender_line", hint: "User gender line" },
      { key: "user_locale", hint: "User locale" },
      { key: "user_timezone", hint: "User timezone" }
    ]
  },
  identity: {
    label: "Identity",
    description: "Assistant identity metadata such as name and avatar.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "assistant_gender_line", hint: "Optional assistant gender line" },
      { key: "assistant_avatar_emoji_line", hint: "Avatar emoji line" },
      { key: "assistant_avatar_url_line", hint: "Avatar URL line" }
    ]
  },
  tools: {
    label: "Native Tool Runtime",
    description:
      "Canonical machine-readable tool instruction block assembled from the actual model-facing tool metadata surface.",
    variables: [
      {
        key: "tools_catalog_block",
        hint: "Compiled runtime tool block generated from the actual declared tool surface"
      }
    ]
  },
  agents: {
    label: "Memory and Task Governance",
    description: "Directly editable governance instructions for memory and scheduled actions.",
    variables: []
  },
  heartbeat: {
    label: "Task Heartbeat",
    description: "Directly editable follow-through instructions for reminders and delayed checks.",
    variables: []
  },
  router_classifier: {
    label: "Routing Classifier Prompt",
    description:
      "Hidden descriptor/system prompt for the early routing classifier. This prompt guides execution-mode, retrieval, and tool hints without answering the user.",
    variables: []
  },
  preview_bootstrap: {
    label: "Preview Character Test",
    description:
      "Hidden prompt used only for setup/recreate preview so admins can test personality and tone without simulating the literal first live chat.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "human_name", hint: "Human display name" },
      { key: "traits_summary_line", hint: "One-line trait summary for preview mode" }
    ]
  },
  welcome_bootstrap: {
    label: "Welcome / First Chat Greeting",
    description: "Hidden prompt used for the real first welcome message after publish or recreate.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "human_name", hint: "Human display name" },
      { key: "traits_summary_line", hint: "One-line trait summary for first conversation" }
    ]
  }
};

const SAMPLE_VARIABLES: Record<string, string> = {
  assistant_identity_block: "Assistant display name: Nova",
  user_identity_block: "User display name: Alex",
  locale_block: "User locale: en-US",
  timezone_block: "User timezone: Europe/Moscow",
  persona_instructions_block:
    "Be helpful and proactive. Suggest ideas when appropriate, but stay grounded.",
  assistant_name: "Nova",
  traits_block:
    "## Personality Traits\n\n- **formality**: 40/100\n- **verbosity**: 60/100\n- **playfulness**: 75/100\n- **initiative**: 55/100\n- **warmth**: 80/100",
  instructions_block:
    "## Instructions\n\nBe helpful and proactive. Suggest ideas when appropriate, but stay grounded.",
  user_name_line: "- **Name**: Alex",
  user_birthday_line: "- **Birthday**: 1995-06-15",
  user_gender_line: "- **Gender**: male",
  user_locale: "en-US",
  user_timezone: "Europe/Moscow",
  assistant_gender_line: "- **Gender**: female",
  assistant_avatar_emoji_line: "- **Avatar**: 🌟",
  assistant_avatar_url_line: "",
  human_name: "Alex",
  traits_summary_line: "They set your personality to: warmth 80/100, playfulness 75/100."
};

const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
const CHIP_CLS_KNOWN = "rounded px-0.5 mx-px bg-accent/15 text-accent inline select-all";
const CHIP_CLS_UNKNOWN = "rounded px-0.5 mx-px bg-yellow-500/15 text-yellow-400 inline select-all";

function interpolateTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    if (!value || value.trim().length === 0) {
      result = result
        .split("\n")
        .filter((line) => !line.includes(placeholder))
        .join("\n");
    } else {
      result = result.replaceAll(placeholder, value);
    }
  }
  return result;
}

function buildPreviewToolCatalogBlock(toolStates: ToolPromptState[]): string {
  const orderedTools = [...toolStates].sort((left, right) => {
    const leftIndex = PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.indexOf(
      left.toolCode as (typeof PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER)[number]
    );
    const rightIndex = PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.indexOf(
      right.toolCode as (typeof PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER)[number]
    );
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
      );
    }
    return left.toolCode.localeCompare(right.toolCode);
  });
  const blocks: string[] = [];
  for (const tool of orderedTools) {
    const description = tool.modelDescription?.trim() || tool.description?.trim() || null;
    const guidance = tool.modelUsageGuidance?.trim() || null;
    const instruction =
      description && guidance ? `${description} ${guidance}` : (description ?? guidance);
    if (instruction) {
      blocks.push(`**\`${tool.toolCode}\`**\n${instruction}`);
    }
  }
  return blocks.join("\n\n").trimEnd();
}

function buildOrdinaryPreview(
  templates: PromptTemplateState[],
  toolStates: ToolPromptState[]
): string {
  const templateById = new Map(
    templates.map((template) => [template.id, template.template] as const)
  );
  const sectionVariables = {
    ...SAMPLE_VARIABLES,
    route_control_block: "",
    tools_catalog_block: buildPreviewToolCatalogBlock(toolStates)
  };
  const sectionById = Object.fromEntries(
    ORDINARY_TEMPLATE_IDS.map((id) => [
      id,
      interpolateTemplate(templateById.get(id) ?? "", sectionVariables).trim()
    ])
  ) as Record<(typeof ORDINARY_TEMPLATE_IDS)[number], string>;
  const systemTemplate =
    templateById.get("system") ??
    `{{assistant_identity_block}}

{{user_identity_block}}

{{locale_block}}

{{timezone_block}}

{{persona_instructions_block}}

{{soul_block}}

{{user_block}}

{{identity_block}}

{{tools_block}}

{{agents_block}}

{{heartbeat_block}}`;
  return interpolateTemplate(systemTemplate, {
    ...SAMPLE_VARIABLES,
    soul_block: sectionById.soul,
    user_block: sectionById.user,
    identity_block: sectionById.identity,
    tools_block: sectionById.tools,
    agents_block: sectionById.agents,
    heartbeat_block: sectionById.heartbeat
  }).trim();
}

function buildOnboardingPreview(
  templates: PromptTemplateState[],
  templateId: (typeof ONBOARDING_TEMPLATE_IDS)[number]
): string {
  const template = templates.find((entry) => entry.id === templateId)?.template ?? "";
  return interpolateTemplate(template, SAMPLE_VARIABLES);
}

function VariableChip({
  variable,
  onInsert
}: {
  variable: { key: string; hint: string };
  onInsert: (key: string) => void;
}) {
  const [inserted, setInserted] = useState(false);

  const handleClick = () => {
    onInsert(variable.key);
    void navigator.clipboard.writeText(`{{${variable.key}}}`);
    setInserted(true);
    setTimeout(() => setInserted(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`${variable.hint} — click to insert at cursor`}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-mono transition-colors",
        inserted
          ? "border-green-500/40 bg-green-500/10 text-green-400"
          : "border-border bg-surface-hover text-text-muted hover:border-accent/40 hover:text-accent"
      )}
    >
      {inserted ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
      {variable.key}
    </button>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function templateToHtml(text: string, knownKeys: Set<string>): string {
  if (!text) return "<br>";
  const parts: string[] = [];
  let last = 0;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(escapeHtml(text.slice(last, match.index)).replace(/\n/g, "<br>"));
    }
    const key = match[1]!;
    const cls = knownKeys.has(key) ? CHIP_CLS_KNOWN : CHIP_CLS_UNKNOWN;
    parts.push(
      `<span contenteditable="false" data-var="${escapeHtml(key)}" class="${cls}">{{${escapeHtml(key)}}}</span>`
    );
    last = re.lastIndex;
  }
  if (last < text.length) {
    parts.push(escapeHtml(text.slice(last)).replace(/\n/g, "<br>"));
  }
  return parts.join("");
}

function serializeDom(node: Node, isRoot = true): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const varKey = node.getAttribute("data-var");
  if (varKey) return `{{${varKey}}}`;
  if (node.tagName === "BR") return "\n";
  let text = "";
  for (const child of node.childNodes) text += serializeDom(child, false);
  if (!isRoot && (node.tagName === "DIV" || node.tagName === "P")) return "\n" + text;
  return text;
}

interface TemplateEditorHandle {
  insertVariable: (key: string) => void;
}

function TemplateEditor({
  value,
  onChange,
  knownKeys,
  handleRef
}: {
  value: string;
  onChange: (value: string) => void;
  knownKeys: Set<string>;
  handleRef: React.MutableRefObject<TemplateEditorHandle | null>;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);

  useEffect(() => {
    const element = editorRef.current;
    if (!element) return;
    if (value === lastValueRef.current && element.innerHTML !== "") return;
    element.innerHTML = templateToHtml(value, knownKeys);
    lastValueRef.current = value;
  }, [value, knownKeys]);

  const handleInput = useCallback(() => {
    const element = editorRef.current;
    if (!element) return;
    const next = serializeDom(element);
    lastValueRef.current = next;
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    handleRef.current = {
      insertVariable(key: string) {
        const element = editorRef.current;
        if (!element) return;
        element.focus();

        const chip = document.createElement("span");
        chip.contentEditable = "false";
        chip.setAttribute("data-var", key);
        chip.className = knownKeys.has(key) ? CHIP_CLS_KNOWN : CHIP_CLS_UNKNOWN;
        chip.textContent = `{{${key}}}`;

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(chip);
          range.setStartAfter(chip);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          element.appendChild(chip);
        }

        const next = serializeDom(element);
        lastValueRef.current = next;
        onChange(next);
      }
    };
  }, [knownKeys, onChange, handleRef]);

  return (
    <div
      ref={editorRef}
      contentEditable
      onInput={handleInput}
      suppressContentEditableWarning
      className="min-h-[180px] w-full overflow-auto rounded border border-border bg-bg p-3 font-mono text-xs text-text whitespace-pre-wrap break-words focus:border-accent/50 focus:outline-none"
    />
  );
}

function PromptTemplateEditor({
  template,
  meta,
  onSave
}: {
  template: PromptTemplateState;
  meta: (typeof PRESET_META)[string];
  onSave: (id: string, template: string) => Promise<void>;
}) {
  const [value, setValue] = useState(template.template);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const editorHandleRef = useRef<TemplateEditorHandle | null>(null);

  const dirty = value !== template.template;
  const knownKeys = useMemo(
    () => new Set(meta.variables.map((entry) => entry.key)),
    [meta.variables]
  );

  const handleSave = async () => {
    setSaving(true);
    await onSave(template.id, value);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">{meta.label}</h3>
          <p className="text-[11px] text-text-muted">{meta.description}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
            dirty
              ? "bg-accent text-white hover:bg-accent/90"
              : "cursor-not-allowed bg-surface-hover text-text-subtle"
          )}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : saved ? (
            <CheckCircle className="h-3 w-3 text-green-400" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {meta.variables.map((variable) => (
          <VariableChip
            key={variable.key}
            variable={variable}
            onInsert={(key) => editorHandleRef.current?.insertVariable(key)}
          />
        ))}
      </div>

      <TemplateEditor
        value={value}
        onChange={setValue}
        knownKeys={knownKeys}
        handleRef={editorHandleRef}
      />
    </div>
  );
}

function ToolPromptEditor({
  tool,
  onSave
}: {
  tool: ToolPromptState;
  onSave: (
    toolCode: string,
    patch: { modelDescription: string; modelUsageGuidance: string }
  ) => Promise<void>;
}) {
  const [modelDescription, setModelDescription] = useState(tool.modelDescription ?? "");
  const [modelUsageGuidance, setModelUsageGuidance] = useState(tool.modelUsageGuidance ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty =
    modelDescription !== (tool.modelDescription ?? "") ||
    modelUsageGuidance !== (tool.modelUsageGuidance ?? "");

  const handleSave = async () => {
    setSaving(true);
    await onSave(tool.toolCode, { modelDescription, modelUsageGuidance });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text">{tool.displayName}</h3>
          </div>
          <p className="text-[11px] text-text-muted">
            <span className="font-mono">{tool.toolCode}</span> · {tool.policyClass} ·{" "}
            {tool.toolClass}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
            dirty
              ? "bg-accent text-white hover:bg-accent/90"
              : "cursor-not-allowed bg-surface-hover text-text-subtle"
          )}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : saved ? (
            <CheckCircle className="h-3 w-3 text-green-400" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <p className="mb-1 text-[11px] font-medium text-text-muted">Model-visible description</p>
          <textarea
            value={modelDescription}
            onChange={(event) => setModelDescription(event.target.value)}
            className="min-h-[72px] w-full rounded border border-border bg-bg p-2 text-xs text-text outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-text-muted">Usage guidance</p>
          <textarea
            value={modelUsageGuidance}
            onChange={(event) => setModelUsageGuidance(event.target.value)}
            className="min-h-[90px] w-full rounded border border-border bg-bg p-2 text-xs text-text outline-none focus:border-accent/50"
          />
        </div>
      </div>
    </div>
  );
}

type PersonaArchetypePatchPayload = Omit<
  PersonaArchetypeAdminState,
  "key" | "updatedAt" | "displayOrder"
> & { displayOrder?: number };

function toEditablePayload(archetype: PersonaArchetypeAdminState): PersonaArchetypePatchPayload {
  return {
    label: archetype.label,
    description: archetype.description,
    voice: archetype.voice,
    openingsAllowed: archetype.openingsAllowed,
    openingsForbidden: archetype.openingsForbidden,
    behaviors: archetype.behaviors,
    silenceRule: archetype.silenceRule,
    examples: archetype.examples,
    defaultTraits: archetype.defaultTraits,
    displayOrder: archetype.displayOrder
  };
}

function PersonaArchetypeEditor({
  archetype,
  onSave,
  onReset
}: {
  archetype: PersonaArchetypeAdminState;
  onSave: (key: string, patch: PersonaArchetypePatchPayload) => Promise<void>;
  onReset: (key: string) => Promise<void>;
}) {
  const initialJson = useMemo(
    () => JSON.stringify(toEditablePayload(archetype), null, 2),
    [archetype]
  );
  const [value, setValue] = useState(initialJson);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialJson);
  }, [initialJson]);

  const dirty = value !== initialJson;

  const handleSave = async () => {
    setParseError(null);
    let parsed: PersonaArchetypePatchPayload;
    try {
      parsed = JSON.parse(value) as PersonaArchetypePatchPayload;
    } catch (cause) {
      setParseError(cause instanceof Error ? cause.message : "Invalid JSON");
      return;
    }
    setSaving(true);
    try {
      await onSave(archetype.key, parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (cause) {
      setParseError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        `Reset archetype "${archetype.key}" to factory default? Your manual edits will be discarded.`
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      await onReset(archetype.key);
    } catch (cause) {
      setParseError(cause instanceof Error ? cause.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text">
            {archetype.label.en} <span className="text-text-muted">/ {archetype.label.ru}</span>
          </h3>
          <p className="text-[11px] text-text-muted">
            <span className="font-mono">{archetype.key}</span> · order {archetype.displayOrder} ·
            voice {archetype.voice.sentenceLength}/{archetype.voice.pace}/irony{" "}
            {archetype.voice.irony}
          </p>
          <p className="mt-1 text-[11px] text-text-muted">{archetype.description.en}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={resetting || saving}
            className="flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-[10px] font-medium text-text-muted transition-colors hover:border-yellow-500/40 hover:text-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resetting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Reset to default
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            className={cn(
              "flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
              dirty
                ? "bg-accent text-white hover:bg-accent/90"
                : "cursor-not-allowed bg-surface-hover text-text-subtle"
            )}
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saved ? (
              <CheckCircle className="h-3 w-3 text-green-400" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        spellCheck={false}
        className="min-h-[360px] w-full rounded border border-border bg-bg p-3 font-mono text-[11px] text-text outline-none focus:border-accent/50"
      />
      {parseError ? (
        <p className="mt-2 text-[11px] text-red-400">{parseError}</p>
      ) : (
        <p className="mt-2 text-[11px] text-text-subtle">
          Edit JSON directly. Fields: label/description/silenceRule/behaviors are bilingual (
          {"{ ru, en }"}). voice.irony is 0–100. defaultTraits are 0–100 sliders that bias
          modulation.
        </p>
      )}
    </div>
  );
}

export default function AdminPresetsPage() {
  const { getToken } = useAuth();
  const [templates, setTemplates] = useState<PromptTemplateState[]>([]);
  const [tools, setTools] = useState<ToolPromptState[]>([]);
  const [archetypes, setArchetypes] = useState<PersonaArchetypeAdminState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"ordinary" | "preview" | "welcome">("ordinary");

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [templateRes, toolRes, archetypeRes] = await Promise.all([
        fetch("/api/v1/admin/prompt-templates", {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch("/api/v1/admin/tools/metadata", {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch("/api/v1/admin/persona-archetypes", {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (!templateRes.ok)
        throw new Error(`Failed to load prompt templates: ${templateRes.status}`);
      if (!toolRes.ok) throw new Error(`Failed to load tool metadata: ${toolRes.status}`);
      if (!archetypeRes.ok)
        throw new Error(`Failed to load persona archetypes: ${archetypeRes.status}`);
      const templateData = (await templateRes.json()) as { presets: PromptTemplateState[] };
      const toolData = (await toolRes.json()) as { tools: ToolPromptState[] };
      const archetypeData = (await archetypeRes.json()) as {
        archetypes: PersonaArchetypeAdminState[];
      };
      setTemplates(templateData.presets);
      setTools(
        toolData.tools.filter((tool) => PROMPT_CONSTRUCTOR_MODEL_TOOL_SET.has(tool.toolCode))
      );
      setArchetypes(
        [...archetypeData.archetypes].sort((left, right) => left.displayOrder - right.displayOrder)
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load prompt constructor.");
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveTemplate = useCallback(
    async (id: string, template: string) => {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/v1/admin/prompt-templates/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ template })
      });
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      const data = (await response.json()) as { preset: PromptTemplateState };
      setTemplates((current) => current.map((entry) => (entry.id === id ? data.preset : entry)));
    },
    [getToken]
  );

  const handleSaveTool = useCallback(
    async (toolCode: string, patch: { modelDescription: string; modelUsageGuidance: string }) => {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/v1/admin/tools/metadata/${toolCode}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          modelDescription: patch.modelDescription,
          modelUsageGuidance: patch.modelUsageGuidance
        })
      });
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      const data = (await response.json()) as { tool: ToolPromptState };
      setTools((current) =>
        current.map((entry) => (entry.toolCode === toolCode ? data.tool : entry))
      );
    },
    [getToken]
  );

  const handleSaveArchetype = useCallback(
    async (key: string, patch: PersonaArchetypePatchPayload) => {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/v1/admin/persona-archetypes/${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      const data = (await response.json()) as { archetype: PersonaArchetypeAdminState };
      setArchetypes((current) =>
        current.map((entry) => (entry.key === key ? data.archetype : entry))
      );
    },
    [getToken]
  );

  const handleResetArchetype = useCallback(
    async (key: string) => {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(
        `/api/v1/admin/persona-archetypes/${encodeURIComponent(key)}/reset-to-default`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!response.ok) throw new Error(`Reset failed: ${response.status}`);
      const data = (await response.json()) as { archetype: PersonaArchetypeAdminState };
      setArchetypes((current) =>
        current.map((entry) => (entry.key === key ? data.archetype : entry))
      );
    },
    [getToken]
  );

  const ordinaryPreview = useMemo(() => buildOrdinaryPreview(templates, tools), [templates, tools]);
  const previewPromptPreview = useMemo(
    () => buildOnboardingPreview(templates, "preview_bootstrap"),
    [templates]
  );
  const welcomePromptPreview = useMemo(
    () => buildOnboardingPreview(templates, "welcome_bootstrap"),
    [templates]
  );
  const generalTools = useMemo(() => tools, [tools]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-xs text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-accent" />
        <h1 className="text-base font-bold text-text">Prompt Constructor</h1>
      </div>
      <p className="max-w-3xl text-xs text-text-muted">
        Edit the real production prompt layers that feed setup preview, welcome onboarding, publish,
        reapply, ordinary runtime turns, and recreate. Character, user context, identity,
        governance, preview/welcome prompts, and per-tool model instructions all live here as one
        control plane.
      </p>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">System Prompt Assembly</h2>
        </div>
        <div className="grid gap-4">
          {SYSTEM_TEMPLATE_IDS.map((id) => {
            const template = templates.find((entry) => entry.id === id);
            const meta = PRESET_META[id];
            if (!template || !meta) return null;
            return (
              <PromptTemplateEditor
                key={id}
                template={template}
                meta={meta}
                onSave={handleSaveTemplate}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Compiled Sections</h2>
        </div>
        <div className="grid gap-4">
          {ORDINARY_TEMPLATE_IDS.map((id) => {
            const template = templates.find((entry) => entry.id === id);
            const meta = PRESET_META[id];
            if (!template || !meta) return null;
            return (
              <PromptTemplateEditor
                key={id}
                template={template}
                meta={meta}
                onSave={handleSaveTemplate}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Routing Prompt</h2>
        </div>
        <p className="text-xs text-text-muted">
          This hidden prompt guides the early routing classifier only. It does not answer the user
          and is separate from runtime policy knobs in Admin &gt; Runtime.
        </p>
        <div className="grid gap-4">
          {ROUTER_TEMPLATE_IDS.map((id) => {
            const template = templates.find((entry) => entry.id === id);
            const meta = PRESET_META[id];
            if (!template || !meta) return null;
            return (
              <PromptTemplateEditor
                key={id}
                template={template}
                meta={meta}
                onSave={handleSaveTemplate}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Preview / Welcome Prompts</h2>
        </div>
        <p className="text-xs text-text-muted">
          Keep preview focused on character testing, and keep welcome focused on the real first live
          greeting after publish or recreate.
        </p>
        <div className="grid gap-4">
          {ONBOARDING_TEMPLATE_IDS.map((id) => {
            const template = templates.find((entry) => entry.id === id);
            const meta = PRESET_META[id];
            if (!template || !meta) return null;
            return (
              <PromptTemplateEditor
                key={id}
                template={template}
                meta={meta}
                onSave={handleSaveTemplate}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Voice DNA Archetypes</h2>
        </div>
        <p className="text-xs text-text-muted">
          Bilingual persona archetypes (en/ru) injected into the soul prompt. Trait sliders modulate
          sentence length, pace, irony, and openings. Editing these values takes effect for new
          ordinary turns after the next config bump.
        </p>
        <div className="grid gap-4">
          {archetypes.map((archetype) => (
            <PersonaArchetypeEditor
              key={archetype.key}
              archetype={archetype}
              onSave={handleSaveArchetype}
              onReset={handleResetArchetype}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Per-Tool Model Instructions</h2>
        </div>
        <p className="text-xs text-text-muted">
          These fields control the model-facing description and usage guidance injected into runtime
          tool policy and native tool definitions.
        </p>
        <div className="grid gap-4">
          {generalTools.map((tool) => (
            <ToolPromptEditor key={tool.toolCode} tool={tool} onSave={handleSaveTool} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Compiled Preview</h2>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPreviewMode("ordinary")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              previewMode === "ordinary"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:text-text"
            )}
          >
            Ordinary turn
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode("preview")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              previewMode === "preview"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:text-text"
            )}
          >
            Preview character test
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode("welcome")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              previewMode === "welcome"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:text-text"
            )}
          >
            Welcome first chat
          </button>
        </div>
        <pre className="max-h-[520px] overflow-auto rounded border border-border bg-bg p-3 text-xs text-text-muted whitespace-pre-wrap">
          {previewMode === "ordinary"
            ? ordinaryPreview
            : previewMode === "preview"
              ? previewPromptPreview
              : welcomePromptPreview}
        </pre>
      </section>
    </div>
  );
}
