"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { FileText, Loader2, Save, CheckCircle, Eye, Copy, Check } from "lucide-react";
import { cn } from "@/app/lib/utils";

interface PresetState {
  id: string;
  template: string;
  updatedAt: string;
}

const PRESET_META: Record<
  string,
  {
    label: string;
    description: string;
    variables: Array<{ key: string; hint: string }>;
  }
> = {
  soul: {
    label: "SOUL.md",
    description: "Assistant personality, traits, and custom instructions",
    variables: [
      { key: "assistant_name", hint: "Name of the assistant" },
      { key: "traits_block", hint: "Auto-generated personality traits list" },
      { key: "instructions_block", hint: "User custom instructions" }
    ]
  },
  user: {
    label: "USER.md",
    description: "Information about the human user",
    variables: [
      { key: "user_name_line", hint: "User display name line" },
      { key: "user_birthday_line", hint: "User birthday line" },
      { key: "user_gender_line", hint: "User gender line" },
      { key: "user_locale", hint: "User locale (e.g. en-US)" },
      { key: "user_timezone", hint: "User timezone (e.g. Europe/Moscow)" }
    ]
  },
  identity: {
    label: "IDENTITY.md",
    description: "Assistant name and visual identity",
    variables: [
      { key: "assistant_name", hint: "Name of the assistant" },
      { key: "assistant_avatar_emoji_line", hint: "Avatar emoji line" },
      { key: "assistant_avatar_url_line", hint: "Avatar URL line" }
    ]
  },
  agents: {
    label: "AGENTS.md",
    description: "Governance, memory and tasks policy",
    variables: [
      { key: "memory_policy_block", hint: "Memory policy section" },
      { key: "tasks_policy_block", hint: "Tasks policy section" }
    ]
  }
};

const PRESET_ORDER = ["soul", "user", "identity", "agents"] as const;

const SAMPLE_VARIABLES: Record<string, string> = {
  assistant_name: "Nova",
  traits_block:
    "## Personality Traits\n\n- **formality**: 40/100 — balanced\n- **verbosity**: 60/100 — balanced detail\n- **playfulness**: 75/100 — playful and fun\n- **initiative**: 55/100 — balanced initiative\n- **warmth**: 80/100 — warm and caring",
  instructions_block:
    "## Instructions\n\nBe helpful and proactive. Suggest ideas when appropriate.",
  user_name_line: "- **Name**: Alex",
  user_birthday_line: "- **Birthday**: 1995-06-15",
  user_gender_line: "- **Gender**: male",
  user_locale: "en-US",
  user_timezone: "Europe/Moscow",
  assistant_avatar_emoji_line: "- **Avatar**: 🌟",
  assistant_avatar_url_line: "",
  memory_policy_block:
    "## Memory Policy\n\n- Remember important facts about your human from conversations\n- Update MEMORY.md with key information you learn\n- Daily conversation notes go in memory/ directory",
  tasks_policy_block:
    "## Tasks Policy\n\n- You may manage reminders and recurring tasks for your human\n- Track tasks in HEARTBEAT.md"
};

function interpolatePreview(template: string): string {
  let result = template;
  for (const [key, value] of Object.entries(SAMPLE_VARIABLES)) {
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

/* ------------------------------------------------------------------ */
/*  contentEditable template editor with atomic variable chips         */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

const CHIP_CLS_KNOWN = "rounded px-0.5 mx-px bg-accent/15 text-accent inline select-all";
const CHIP_CLS_UNKNOWN = "rounded px-0.5 mx-px bg-yellow-500/15 text-yellow-400 inline select-all";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function templateToHtml(text: string, knownKeys: Set<string>): string {
  if (!text) return "<br>";
  const parts: string[] = [];
  let last = 0;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(escapeHtml(text.slice(last, m.index)).replace(/\n/g, "<br>"));
    }
    const key = m[1]!;
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
  onChange: (v: string) => void;
  knownKeys: Set<string>;
  handleRef: React.MutableRefObject<TemplateEditorHandle | null>;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastValueRef.current && el.innerHTML !== "") return;
    el.innerHTML = templateToHtml(value, knownKeys);
    lastValueRef.current = value;
  }, [value, knownKeys]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const s = serializeDom(el);
    lastValueRef.current = s;
    onChange(s);
  }, [onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.execCommand("insertLineBreak");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    handleRef.current = {
      insertVariable(key: string) {
        const el = editorRef.current;
        if (!el) return;
        el.focus();

        const chip = document.createElement("span");
        chip.contentEditable = "false";
        chip.setAttribute("data-var", key);
        chip.className = knownKeys.has(key) ? CHIP_CLS_KNOWN : CHIP_CLS_UNKNOWN;
        chip.textContent = `{{${key}}}`;

        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(chip);
          range.setStartAfter(chip);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          el.appendChild(chip);
        }

        const s = serializeDom(el);
        lastValueRef.current = s;
        onChange(s);
      }
    };
  }, [knownKeys, onChange, handleRef]);

  return (
    <div
      ref={editorRef}
      contentEditable
      onInput={handleInput}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      suppressContentEditableWarning
      className="min-h-[200px] w-full overflow-auto rounded border border-border bg-bg p-3 font-mono text-xs text-text whitespace-pre-wrap break-words focus:border-accent/50 focus:outline-none"
    />
  );
}

/* ------------------------------------------------------------------ */

function PresetEditor({
  preset,
  meta,
  onSave
}: {
  preset: PresetState;
  meta: (typeof PRESET_META)[string];
  onSave: (id: string, template: string) => Promise<void>;
}) {
  const [template, setTemplate] = useState(preset.template);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const editorHandleRef = useRef<TemplateEditorHandle | null>(null);

  const dirty = template !== preset.template;

  const knownKeys = useMemo(() => new Set(meta.variables.map((v) => v.key)), [meta.variables]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(preset.id, template);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleInsert = useCallback((key: string) => {
    editorHandleRef.current?.insertVariable(key);
  }, []);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">{meta.label}</h3>
          <p className="text-[11px] text-text-muted">{meta.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className={cn(
              "flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
              showPreview ? "bg-accent/10 text-accent" : "text-text-subtle hover:text-text-muted"
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
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

      {/* Variable chips */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {meta.variables.map((v) => (
          <VariableChip key={v.key} variable={v} onInsert={handleInsert} />
        ))}
      </div>

      {/* Editor / Preview */}
      {showPreview ? (
        <pre className="max-h-[400px] overflow-auto rounded border border-border bg-bg p-3 text-xs text-text-muted whitespace-pre-wrap">
          {interpolatePreview(template)}
        </pre>
      ) : (
        <TemplateEditor
          value={template}
          onChange={setTemplate}
          knownKeys={knownKeys}
          handleRef={editorHandleRef}
        />
      )}
    </div>
  );
}

export default function AdminPresetsPage() {
  const { getToken } = useAuth();
  const [presets, setPresets] = useState<PresetState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/bootstrap-presets", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to load presets: ${res.status}`);
      const data = (await res.json()) as { presets: PresetState[] };
      setPresets(data.presets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(
    async (id: string, template: string) => {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/v1/admin/bootstrap-presets/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ template })
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const data = (await res.json()) as { preset: PresetState };
      setPresets((prev) => prev.map((p) => (p.id === id ? data.preset : p)));
    },
    [getToken]
  );

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
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-accent" />
        <h1 className="text-base font-bold text-text">Bootstrap Document Presets</h1>
      </div>
      <p className="text-xs text-text-muted">
        Edit the Markdown templates used to generate bootstrap documents for new and recreated
        assistants. Use variable chips below each editor to insert dynamic placeholders. Lines
        containing a placeholder with an empty value are automatically removed.
      </p>

      {PRESET_ORDER.map((id) => {
        const preset = presets.find((p) => p.id === id);
        const meta = PRESET_META[id];
        if (!preset || !meta) return null;
        return <PresetEditor key={id} preset={preset} meta={meta} onSave={handleSave} />;
      })}
    </div>
  );
}
