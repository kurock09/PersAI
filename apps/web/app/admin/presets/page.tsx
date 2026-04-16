"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Check, CheckCircle, Copy, Eye, FileText, Loader2, Save, Wrench } from "lucide-react";
import { cn } from "@/app/lib/utils";

interface PromptTemplateState {
  id: string;
  template: string;
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

const ORDINARY_TEMPLATE_IDS = ["soul", "user", "identity", "tools", "agents", "heartbeat"] as const;
const ONBOARDING_TEMPLATE_IDS = ["bootstrap"] as const;

const PRESET_META: Record<
  string,
  {
    label: string;
    description: string;
    variables: Array<{ key: string; hint: string }>;
  }
> = {
  soul: {
    label: "Character Generator",
    description: "Core assistant persona, traits, and persistent behavioral instructions.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "assistant_gender_line", hint: "Optional assistant gender line" },
      { key: "traits_block", hint: "Generated personality traits summary" },
      { key: "instructions_block", hint: "Explicit user-owned instructions block" }
    ]
  },
  user: {
    label: "User Context Generator",
    description: "Structured human context available to the runtime during ordinary turns.",
    variables: [
      { key: "user_name_line", hint: "User display name line" },
      { key: "user_birthday_line", hint: "User birthday line" },
      { key: "user_gender_line", hint: "User gender line" },
      { key: "user_locale", hint: "User locale" },
      { key: "user_timezone", hint: "User timezone" }
    ]
  },
  identity: {
    label: "Identity Generator",
    description: "Assistant identity metadata such as name, avatar, and visual identity.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "assistant_gender_line", hint: "Optional assistant gender line" },
      { key: "assistant_avatar_emoji_line", hint: "Avatar emoji line" },
      { key: "assistant_avatar_url_line", hint: "Avatar URL line" }
    ]
  },
  tools: {
    label: "Tool Runtime Section",
    description:
      "System-prompt section for tool availability, tool descriptions, and tool usage guidance.",
    variables: [
      {
        key: "tools_catalog_block",
        hint: "Compiled runtime tool block generated from active tool metadata and policy truth"
      }
    ]
  },
  agents: {
    label: "Governance Section",
    description: "Memory and task governance instructions used during ordinary runtime turns.",
    variables: [
      { key: "memory_policy_block", hint: "Generated memory policy block" },
      { key: "tasks_policy_block", hint: "Generated tasks policy block" }
    ]
  },
  heartbeat: {
    label: "Task Heartbeat Section",
    description: "Scheduler continuity instructions used for task and reminder follow-through.",
    variables: [{ key: "tasks_heartbeat_hint", hint: "Generated scheduler heartbeat guidance" }]
  },
  bootstrap: {
    label: "Onboarding / Recreate Greeting",
    description:
      "First-turn prompt used by setup preview and recreate onboarding instead of a hidden bootstrap file.",
    variables: [
      { key: "assistant_name", hint: "Assistant display name" },
      { key: "human_name", hint: "Human display name" },
      { key: "traits_summary_line", hint: "One-line trait summary for first conversation" }
    ]
  }
};

const SAMPLE_VARIABLES: Record<string, string> = {
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
  memory_policy_block:
    "## Memory Policy\n\n- Remember important long-lived user facts.\n- Avoid storing transient turn noise.",
  tasks_policy_block:
    "## Tasks Policy\n\n- Manage reminders and follow-ups carefully.\n- Prefer low-pressure user-facing reminders.",
  tasks_heartbeat_hint:
    "Track upcoming reminder/task follow-ups and preserve scheduler continuity context between runs.",
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
  const preferredActive = ["web_search", "web_fetch", "scheduled_action", "tts"];
  const active = toolStates.filter((tool) => preferredActive.includes(tool.toolCode));
  const disabled = toolStates
    .filter((tool) => !preferredActive.includes(tool.toolCode))
    .slice(0, 4);

  const lines: string[] = ["## Active Tools", ""];
  for (const tool of active) {
    lines.push(
      `- **${tool.toolCode}** — ${tool.modelDescription ?? tool.description ?? tool.displayName}${
        tool.modelUsageGuidance ? ` Guidance: ${tool.modelUsageGuidance}` : ""
      }`
    );
  }
  lines.push("");
  if (disabled.length > 0) {
    lines.push("## Hidden Or Disabled In This Preview");
    lines.push("");
    for (const tool of disabled) {
      lines.push(`- ~~${tool.toolCode}~~ — ${tool.displayName}`);
    }
    lines.push("");
  }
  lines.push("## Usage Rules");
  lines.push("");
  lines.push(
    "- Use only the machine-readable tools actually declared for the turn. The block above explains intent, not availability by itself."
  );
  return lines.join("\n").trimEnd();
}

function buildOrdinaryPreview(
  templates: PromptTemplateState[],
  toolStates: ToolPromptState[]
): string {
  const templateById = new Map(
    templates.map((template) => [template.id, template.template] as const)
  );
  const variables = {
    ...SAMPLE_VARIABLES,
    tools_catalog_block: buildPreviewToolCatalogBlock(toolStates)
  };
  const sections = ORDINARY_TEMPLATE_IDS.map((id) =>
    interpolateTemplate(templateById.get(id) ?? "", variables)
  ).filter((section) => section.trim().length > 0);
  return [
    "Assistant display name: Nova",
    "User display name: Alex",
    "User locale: en-US",
    "User timezone: Europe/Moscow",
    ...sections
  ].join("\n\n");
}

function buildOnboardingPreview(templates: PromptTemplateState[]): string {
  const template = templates.find((entry) => entry.id === "bootstrap")?.template ?? "";
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
          <h3 className="text-sm font-semibold text-text">{tool.displayName}</h3>
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

export default function AdminPresetsPage() {
  const { getToken } = useAuth();
  const [templates, setTemplates] = useState<PromptTemplateState[]>([]);
  const [tools, setTools] = useState<ToolPromptState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"ordinary" | "onboarding">("ordinary");

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [templateRes, toolRes] = await Promise.all([
        fetch("/api/v1/admin/prompt-templates", {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch("/api/v1/admin/tools/metadata", {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (!templateRes.ok)
        throw new Error(`Failed to load prompt templates: ${templateRes.status}`);
      if (!toolRes.ok) throw new Error(`Failed to load tool metadata: ${toolRes.status}`);
      const templateData = (await templateRes.json()) as { presets: PromptTemplateState[] };
      const toolData = (await toolRes.json()) as { tools: ToolPromptState[] };
      setTemplates(templateData.presets);
      setTools(toolData.tools);
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

  const ordinaryPreview = useMemo(() => buildOrdinaryPreview(templates, tools), [templates, tools]);
  const onboardingPreview = useMemo(() => buildOnboardingPreview(templates), [templates]);

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
        Edit the real production prompt layers that feed setup preview, publish, reapply, ordinary
        runtime turns, and recreate. Character, user context, identity, governance, onboarding, and
        per-tool model instructions all live here as one control plane.
      </p>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Ordinary Runtime Prompt</h2>
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
          <h2 className="text-sm font-semibold text-text">Onboarding / Recreate Prompt</h2>
        </div>
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
          <Wrench className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text">Per-Tool Model Instructions</h2>
        </div>
        <p className="text-xs text-text-muted">
          These fields control the model-facing description and usage guidance injected into runtime
          tool policy and native tool definitions.
        </p>
        <div className="grid gap-4">
          {tools.map((tool) => (
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
            onClick={() => setPreviewMode("onboarding")}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium",
              previewMode === "onboarding"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:text-text"
            )}
          >
            Onboarding / recreate
          </button>
        </div>
        <pre className="max-h-[520px] overflow-auto rounded border border-border bg-bg p-3 text-xs text-text-muted whitespace-pre-wrap">
          {previewMode === "ordinary" ? ordinaryPreview : onboardingPreview}
        </pre>
      </section>
    </div>
  );
}
