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
  codeDefaultModelDescription?: string | null;
  codeDefaultModelUsageGuidance?: string | null;
  modelDescriptionOverridden?: boolean;
  modelUsageGuidanceOverridden?: boolean;
  toolClass: "cost_driving" | "utility";
  capabilityGroup: "knowledge" | "automation" | "communication" | "workspace_ops";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  catalogStatus: "active" | "inactive";
}

const SYSTEM_TEMPLATE_IDS = ["system"] as const;
const ORDINARY_TEMPLATE_IDS = [
  "soul",
  "user",
  "identity",
  "enabled_skills",
  "reminders_protocol",
  "memory_protocol",
  "response_contract",
  "tools",
  "agents",
  "heartbeat",
  "presence"
] as const;
const ROUTER_TEMPLATE_IDS = ["router_classifier"] as const;
const ONBOARDING_TEMPLATE_IDS = ["preview_bootstrap", "welcome_bootstrap"] as const;

const SOUL_VOICE_DNA_BLOCK = `{{archetype_label_line}}

# Voice
- Sentence length: {{voice_sentence_length}}
- Pace: {{voice_pace}}
- Irony: {{voice_irony}}/100

# How you may open
You may open with phrasings like: {{voice_openings_allowed}}.
Never open with phrasings like: {{voice_openings_forbidden}}.

# How you behave under emotion
- When the user is upset: {{voice_when_user_upset}}
- When the user is excited: {{voice_when_user_excited}}
- When the user is tired: {{voice_when_user_tired}}
- When the user is angry: {{voice_when_user_angry}}

# Silence
{{voice_silence_rule}}

# How you actually sound
{{voice_examples_block}}`;

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
      "The backend ordinary-turn assembly order. Edit the fetched system template directly; reset-to-default restores the API-owned default.",
    variables: [
      { key: "soul_block", hint: "Core persona block with voice + character notes" },
      { key: "user_block", hint: "Structured user context block" },
      { key: "identity_block", hint: "Assistant identity metadata block" },
      { key: "enabled_skills_block", hint: "Compiled enabled Skills catalog block" },
      {
        key: "reminders_protocol_block",
        hint: "Declares how runtime <system-reminder> blocks should be interpreted"
      },
      {
        key: "memory_protocol_block",
        hint: "Long-term memory read/write rules for ordinary turns"
      },
      {
        key: "response_contract_block",
        hint: "Reply-formatting and delivery-honesty contract"
      },
      { key: "tools_block", hint: "Native Tool Runtime selection guide block" },
      { key: "agents_block", hint: "Optional trailing stable system block" }
    ]
  },
  soul: {
    label: "Core Persona",
    description: "Assistant persona, traits, and explicit instructions.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "assistant_gender_line", hint: "Optional assistant gender line" },
      { key: "archetype_label_line", hint: "Resolved Voice DNA archetype label line" },
      { key: "voice_sentence_length", hint: "Resolved sentence-length style" },
      { key: "voice_pace", hint: "Resolved pace style" },
      { key: "voice_irony", hint: "Resolved irony score 0-100" },
      { key: "voice_openings_allowed", hint: "Allowed opening phrase list" },
      { key: "voice_openings_forbidden", hint: "Forbidden opening phrase list" },
      { key: "voice_when_user_upset", hint: "Behavior when user is upset" },
      { key: "voice_when_user_excited", hint: "Behavior when user is excited" },
      { key: "voice_when_user_tired", hint: "Behavior when user is tired" },
      { key: "voice_when_user_angry", hint: "Behavior when user is angry" },
      { key: "voice_silence_rule", hint: "Silence / restraint rule" },
      { key: "voice_examples_block", hint: "Rendered Voice DNA examples block" },
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
  enabled_skills: {
    label: "Enabled Skills",
    description:
      "Prompt Constructor block for user-enabled professional Skill instruction cards. Empty when no active Skill is enabled or the assignment is disabled, archived, or over the plan limit.",
    variables: [{ key: "skill_cards_block", hint: "Rendered enabled Skill cards" }]
  },
  reminders_protocol: {
    label: "Reminders Protocol",
    description:
      "Declares that runtime <system-reminder> blocks are system directives injected mid-conversation under recency bias.",
    variables: []
  },
  memory_protocol: {
    label: "Memory Protocol",
    description:
      "Defines pull-first long-term memory recall and the rules for immediate memory_write on durable facts, preferences, and open loops.",
    variables: []
  },
  response_contract: {
    label: "Response Contract",
    description:
      "Sets reply-formatting, code-block preservation, and delivery honesty rules for ordinary turns.",
    variables: []
  },
  tools: {
    label: "Native Tool Runtime — Selection Guide",
    description:
      "Cross-tool selection guide in the cached system prefix. Edit here to control which tool the model calls and when. Per-tool mechanical contract (description, usage guidance) lives in Per-Tool Model Instructions below.",
    variables: []
  },
  agents: {
    label: "Trailing System Notes",
    description:
      "Optional trailing stable system block after the tool selection guide. Empty by default; use only for extra always-on system instructions that do not belong in another owned section.",
    variables: []
  },
  heartbeat: {
    label: "Background Task Evaluation",
    description: "Directly editable evaluator instructions for assistant background tasks.",
    variables: []
  },
  presence: {
    label: "Sense of Time",
    description:
      "Per-turn developer-tail block injecting time-since-last-user-message (in-thread + cross-thread), current local HH:MM, and current local weekday so the model can quietly colour its tone. Lives only in developerInstructions; never enters the cached system prompt.",
    variables: [
      {
        key: "time_since_last_user_message_in_thread",
        hint: "Bilingual relative time-ago of the last user message in this thread"
      },
      {
        key: "time_since_last_user_message_anywhere",
        hint: "Bilingual relative time-ago of the last user message across any thread for this user/assistant"
      },
      {
        key: "current_local_time",
        hint: "Current wall clock in the user's timezone, formatted HH:MM"
      },
      {
        key: "current_local_weekday",
        hint: "Current local weekday in the user's locale (e.g. Monday / понедельник)"
      }
    ]
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
      "Hidden prompt used only for setup/recreate preview so admins can test how the assistant introduces itself and how its tone feels before the first real chat.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "human_name", hint: "Human display name" },
      { key: "voice_summary_line", hint: "Resolved one-line voice/archetype summary" },
      { key: "traits_summary_line", hint: "One-line trait summary for preview mode" }
    ]
  },
  welcome_bootstrap: {
    label: "Welcome / First Chat Greeting",
    description:
      "Hidden prompt for the real first greeting after publish or recreate. Structured Markdown intro: hello, first-meeting warmth, 4 feature bullets with emoji, light closing invite.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "human_name", hint: "Human display name" },
      { key: "voice_summary_line", hint: "Resolved one-line voice/archetype summary" },
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
  voice_summary_line:
    "Your voice is **Magnetic Strategist** — warm, concise, confident, and slightly playful.",
  traits_summary_line: "They set your personality to: warmth 80/100, playfulness 75/100.",
  skill_cards_block:
    '<!-- Enabled Skills catalog. Pass <skill id="..."> value verbatim as skillId to skill({action:"engage"}) to activate. -->\n<skill id="skl_accounting_demo" key="skl_accounting_demo">\n  <display_name>Accountant</display_name>\n  <summary>Accounting support</summary>\n  <category>finance</category>\n  <tags>tax, books</tags>\n  <available_scenarios />\n</skill>',
  time_since_last_user_message_in_thread: "earlier today",
  time_since_last_user_message_anywhere: "yesterday",
  current_local_time: "21:47",
  current_local_weekday: "Thursday"
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
  const blocks: string[] = [];
  for (const tool of toolStates) {
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

function supportsCodeDefault(tool: ToolPromptState): boolean {
  return (
    tool.codeDefaultModelDescription !== undefined ||
    tool.codeDefaultModelUsageGuidance !== undefined ||
    tool.modelDescriptionOverridden !== undefined ||
    tool.modelUsageGuidanceOverridden !== undefined
  );
}

function usesCodeDefault(tool: ToolPromptState): boolean {
  return tool.modelDescriptionOverridden !== true && tool.modelUsageGuidanceOverridden !== true;
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
    skill_cards_block: SAMPLE_VARIABLES.skill_cards_block ?? "",
    tools_catalog_block: buildPreviewToolCatalogBlock(toolStates)
  };
  const sectionById = Object.fromEntries(
    ORDINARY_TEMPLATE_IDS.map((id) => [
      id,
      interpolateTemplate(templateById.get(id) ?? "", sectionVariables).trim()
    ])
  ) as Record<(typeof ORDINARY_TEMPLATE_IDS)[number], string>;
  const systemTemplate = templateById.get("system") ?? "";
  return interpolateTemplate(systemTemplate, {
    ...SAMPLE_VARIABLES,
    soul_block: sectionById.soul,
    user_block: sectionById.user,
    identity_block: sectionById.identity,
    enabled_skills_block: sectionById.enabled_skills,
    reminders_protocol_block: sectionById.reminders_protocol,
    memory_protocol_block: sectionById.memory_protocol,
    response_contract_block: sectionById.response_contract,
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
  onSave,
  onReset
}: {
  template: PromptTemplateState;
  meta: (typeof PRESET_META)[string];
  onSave: (id: string, template: string) => Promise<void>;
  onReset: (id: string) => Promise<PromptTemplateState>;
}) {
  const [value, setValue] = useState(template.template);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorHandleRef = useRef<TemplateEditorHandle | null>(null);

  useEffect(() => {
    setValue(template.template);
  }, [template.template]);

  const dirty = value !== template.template;
  const knownKeys = useMemo(
    () => new Set(meta.variables.map((entry) => entry.key)),
    [meta.variables]
  );

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(template.id, value);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (cause) {
      console.error("[admin-presets] handleSaveTemplate failed", cause);
      setSaveError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        `Reset prompt template "${template.id}" to factory default? Your manual edits will be discarded.`
      )
    ) {
      return;
    }
    setSaveError(null);
    setResetting(true);
    try {
      const resetTemplate = await onReset(template.id);
      setValue(resetTemplate.template);
    } catch (cause) {
      console.error("[admin-presets] handleResetTemplate failed", cause);
      setSaveError(cause instanceof Error ? cause.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const handleInsertSoulVoiceDnaBlock = () => {
    setValue((current) => {
      const trimmed = current.trimEnd();
      if (trimmed.includes("{{voice_examples_block}}")) {
        return current;
      }
      return trimmed.length === 0 ? SOUL_VOICE_DNA_BLOCK : `${trimmed}\n\n${SOUL_VOICE_DNA_BLOCK}`;
    });
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">{meta.label}</h3>
          <p className="text-[11px] text-text-muted">{meta.description}</p>
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

      <div className="mb-2 flex flex-wrap gap-1.5">
        {meta.variables.map((variable) => (
          <VariableChip
            key={variable.key}
            variable={variable}
            onInsert={(key) => editorHandleRef.current?.insertVariable(key)}
          />
        ))}
        {template.id === "soul" ? (
          <button
            type="button"
            onClick={handleInsertSoulVoiceDnaBlock}
            title="Append the full Voice DNA section to this Soul template"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-medium text-accent transition-colors hover:bg-accent/15"
          >
            <Sparkles className="h-2.5 w-2.5" />
            Insert Voice DNA block
          </button>
        ) : null}
      </div>

      <TemplateEditor
        value={value}
        onChange={setValue}
        knownKeys={knownKeys}
        handleRef={editorHandleRef}
      />

      {saveError ? (
        <p className="mt-2 text-[11px] text-red-400" role="alert">
          {saveError}
        </p>
      ) : null}
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
    patch: { modelDescription: string | null; modelUsageGuidance: string | null }
  ) => Promise<void>;
}) {
  const codeDefaultEnabled = supportsCodeDefault(tool);
  const persistedUseCodeDefault = usesCodeDefault(tool);
  const [modelDescription, setModelDescription] = useState(tool.modelDescription ?? "");
  const [modelUsageGuidance, setModelUsageGuidance] = useState(tool.modelUsageGuidance ?? "");
  const [useCodeDefault, setUseCodeDefault] = useState(persistedUseCodeDefault);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setModelDescription(tool.modelDescription ?? "");
    setModelUsageGuidance(tool.modelUsageGuidance ?? "");
    setUseCodeDefault(persistedUseCodeDefault);
  }, [persistedUseCodeDefault, tool.modelDescription, tool.modelUsageGuidance, tool.toolCode]);

  const dirty = codeDefaultEnabled
    ? useCodeDefault !== persistedUseCodeDefault ||
      (!useCodeDefault &&
        (modelDescription !== (tool.modelDescription ?? "") ||
          modelUsageGuidance !== (tool.modelUsageGuidance ?? "")))
    : modelDescription !== (tool.modelDescription ?? "") ||
      modelUsageGuidance !== (tool.modelUsageGuidance ?? "");

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(tool.toolCode, {
        modelDescription: codeDefaultEnabled && useCodeDefault ? null : modelDescription,
        modelUsageGuidance: codeDefaultEnabled && useCodeDefault ? null : modelUsageGuidance
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (cause) {
      console.error("[admin-presets] handleSaveTool failed", cause);
      setSaveError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (
      !window.confirm(
        `Reset tool "${tool.displayName}" to the code default prompt text? Any manual override will be cleared.`
      )
    ) {
      return;
    }
    const defaultDescription = tool.codeDefaultModelDescription ?? "";
    const defaultGuidance = tool.codeDefaultModelUsageGuidance ?? "";
    setSaveError(null);
    setUseCodeDefault(true);
    setModelDescription(defaultDescription);
    setModelUsageGuidance(defaultGuidance);
    if (persistedUseCodeDefault) {
      return;
    }
    setSaving(true);
    try {
      await onSave(tool.toolCode, {
        modelDescription: null,
        modelUsageGuidance: null
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (cause) {
      console.error("[admin-presets] handleResetTool failed", cause);
      setUseCodeDefault(persistedUseCodeDefault);
      setModelDescription(tool.modelDescription ?? "");
      setModelUsageGuidance(tool.modelUsageGuidance ?? "");
      setSaveError(cause instanceof Error ? cause.message : "Reset failed");
    } finally {
      setSaving(false);
    }
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
        <div className="flex shrink-0 items-center gap-2">
          {codeDefaultEnabled ? (
            <button
              type="button"
              onClick={() => void handleResetToDefault()}
              disabled={saving || (persistedUseCodeDefault && useCodeDefault && !dirty)}
              className="flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-[10px] font-medium text-text-muted transition-colors hover:border-yellow-500/40 hover:text-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </button>
          ) : null}
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

      <div className="space-y-3">
        {codeDefaultEnabled ? (
          <div className="rounded border border-border bg-bg/70 p-2">
            <label className="flex items-center gap-2 text-[11px] text-text">
              <input
                type="checkbox"
                checked={useCodeDefault}
                onChange={(event) => {
                  const next = event.target.checked;
                  setUseCodeDefault(next);
                  if (next) {
                    setModelDescription(tool.codeDefaultModelDescription ?? "");
                    setModelUsageGuidance(tool.codeDefaultModelUsageGuidance ?? "");
                  }
                }}
                className="h-3.5 w-3.5 rounded border-border bg-bg text-accent"
              />
              Use code default
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Enabled = read-only, code-backed prompt text. Disable it only when you intentionally
              want this tool to use a manual override.
            </p>
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-[11px] font-medium text-text-muted">Model-visible description</p>
          <textarea
            value={modelDescription}
            onChange={(event) => setModelDescription(event.target.value)}
            readOnly={codeDefaultEnabled && useCodeDefault}
            className={cn(
              "min-h-[72px] w-full rounded border border-border p-2 text-xs text-text outline-none focus:border-accent/50",
              codeDefaultEnabled && useCodeDefault
                ? "cursor-not-allowed bg-surface-hover text-text-muted"
                : "bg-bg"
            )}
          />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-text-muted">Usage guidance</p>
          <textarea
            value={modelUsageGuidance}
            onChange={(event) => setModelUsageGuidance(event.target.value)}
            readOnly={codeDefaultEnabled && useCodeDefault}
            className={cn(
              "min-h-[90px] w-full rounded border border-border p-2 text-xs text-text outline-none focus:border-accent/50",
              codeDefaultEnabled && useCodeDefault
                ? "cursor-not-allowed bg-surface-hover text-text-muted"
                : "bg-bg"
            )}
          />
        </div>
      </div>

      {saveError ? (
        <p className="mt-2 text-[11px] text-red-400" role="alert">
          {saveError}
        </p>
      ) : null}
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
  const [resettingAllTools, setResettingAllTools] = useState(false);

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
      setTools(toolData.tools);
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

  const handleResetTemplate = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (!token) throw new Error("Missing admin auth token.");
      const response = await fetch(
        `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}/reset-to-default`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to reset prompt template "${id}" to default.`);
      }
      const data = (await response.json()) as { preset: PromptTemplateState };
      setTemplates((current) => current.map((entry) => (entry.id === id ? data.preset : entry)));
      return data.preset;
    },
    [getToken, handleSaveTemplate]
  );

  const handleSaveTool = useCallback(
    async (
      toolCode: string,
      patch: { modelDescription: string | null; modelUsageGuidance: string | null }
    ) => {
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

  const resettableTools = useMemo(() => tools.filter((tool) => supportsCodeDefault(tool)), [tools]);
  const overriddenToolCount = useMemo(
    () => resettableTools.filter((tool) => !usesCodeDefault(tool)).length,
    [resettableTools]
  );

  const handleResetAllTools = useCallback(async () => {
    if (overriddenToolCount === 0) {
      return;
    }
    if (
      !window.confirm(
        `Reset ${String(overriddenToolCount)} tool override${overriddenToolCount === 1 ? "" : "s"} to code defaults?`
      )
    ) {
      return;
    }
    setResettingAllTools(true);
    setError(null);
    try {
      for (const tool of resettableTools) {
        if (usesCodeDefault(tool)) {
          continue;
        }
        await handleSaveTool(tool.toolCode, {
          modelDescription: null,
          modelUsageGuidance: null
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reset tool overrides.");
    } finally {
      setResettingAllTools(false);
    }
  }, [handleSaveTool, overriddenToolCount, resettableTools]);

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
    <div className="w-full space-y-6">
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
                onReset={handleResetTemplate}
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
                onReset={handleResetTemplate}
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
                onReset={handleResetTemplate}
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
                onReset={handleResetTemplate}
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text">Per-Tool Model Instructions</h2>
          </div>
          <button
            type="button"
            onClick={() => void handleResetAllTools()}
            disabled={resettingAllTools || overriddenToolCount === 0}
            className="flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-[10px] font-medium text-text-muted transition-colors hover:border-yellow-500/40 hover:text-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resettingAllTools ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Reset all tools to code defaults
          </button>
        </div>
        <p className="text-xs text-text-muted">
          These fields control the model-facing description and usage guidance injected into runtime
          tool policy and native tool definitions. Tool prompts are code-backed and read-only by
          default; disable `Use code default` only when you intentionally need a manual override.
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
