"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { FileText, Library, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  deleteAdminKnowledgeSource,
  getAdminKnowledgeConnectors,
  getAdminKnowledgeObservability,
  getAdminKnowledgeRetrievalPolicy,
  getAdminRuntimeProviderSettings,
  getAdminKnowledgeSources,
  reindexAdminKnowledgeSource,
  updateAdminKnowledgeRetrievalPolicy,
  uploadAdminKnowledgeSource,
  type AdminKnowledgeConnectorState,
  type AdminKnowledgeObservabilityState,
  type AdminKnowledgeRetrievalPolicyState,
  type AdminRuntimeProviderSettingsState,
  type AdminKnowledgeSourceState
} from "@/app/app/assistant-api-client";

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value === 0 ? 0 : 1)}%`;
}

function formatWhen(value: string | null): string {
  if (!value) {
    return "No data yet";
  }
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  });
}

type ModelOption = {
  provider: string;
  model: string;
};

export function flattenAvailableTextModelOptions(
  settings: Pick<
    AdminRuntimeProviderSettingsState,
    "availableModelsByProvider" | "availableModelCatalogByProvider"
  > | null
): ModelOption[] {
  if (settings === null) {
    return [];
  }

  const result: ModelOption[] = [];
  const seen = new Set<string>();
  const append = (provider: string, model: string) => {
    const normalizedProvider = provider.trim();
    const normalizedModel = model.trim();
    if (normalizedProvider.length === 0 || normalizedModel.length === 0) {
      return;
    }
    const key = `${normalizedProvider}:${normalizedModel}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({ provider: normalizedProvider, model: normalizedModel });
  };

  for (const [provider, models] of Object.entries(settings.availableModelsByProvider ?? {})) {
    for (const model of models ?? []) {
      append(provider, model);
    }
  }
  if (result.length > 0) {
    return result;
  }

  for (const [provider, catalog] of Object.entries(
    settings.availableModelCatalogByProvider ?? {}
  )) {
    for (const model of catalog?.chat ?? []) {
      append(provider, model);
    }
  }
  return result;
}

function ModelOptionSelect({
  value,
  onChange,
  options,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  options: ModelOption[];
  placeholder: string;
}) {
  const grouped = options.reduce<Record<string, string[]>>((acc, { provider, model }) => {
    (acc[provider] ??= []).push(model);
    return acc;
  }, {});

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-text outline-none focus:border-accent"
    >
      <option value="">{placeholder}</option>
      {Object.entries(grouped).map(([provider, models]) => (
        <optgroup key={provider} label={provider}>
          {models.map((model) => (
            <option key={`${provider}-${model}`} value={model}>
              {model}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function AdminKnowledgePage() {
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<AdminKnowledgeSourceState[]>([]);
  const [observability, setObservability] = useState<AdminKnowledgeObservabilityState | null>(null);
  const [connectors, setConnectors] = useState<AdminKnowledgeConnectorState[]>([]);
  const [retrievalPolicy, setRetrievalPolicy] = useState<AdminKnowledgeRetrievalPolicyState | null>(
    null
  );
  const [embeddingModelDraft, setEmbeddingModelDraft] = useState("");
  const [retrievalModelDraft, setRetrievalModelDraft] = useState("");
  const [availableModelKeys, setAvailableModelKeys] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setFeedback("Session expired. Please sign in again.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const [nextSources, nextObservability, nextConnectors, nextRetrievalPolicy, runtimeSettings] =
        await Promise.all([
          getAdminKnowledgeSources(token, "product"),
          getAdminKnowledgeObservability(token),
          getAdminKnowledgeConnectors(token, "product"),
          getAdminKnowledgeRetrievalPolicy(token),
          getAdminRuntimeProviderSettings(token).catch(() => null)
        ]);
      setSources(nextSources);
      setObservability(nextObservability);
      setConnectors(nextConnectors);
      setRetrievalPolicy(nextRetrievalPolicy);
      setEmbeddingModelDraft(nextRetrievalPolicy.embeddingModelKey ?? "");
      setRetrievalModelDraft(nextRetrievalPolicy.retrievalModelKey ?? "");
      setAvailableModelKeys(flattenAvailableTextModelOptions(runtimeSettings));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load knowledge sources.");
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalBytes = useMemo(
    () => sources.reduce((sum, source) => sum + source.sizeBytes, 0),
    [sources]
  );
  const sourceSummaries = useMemo(() => {
    const bySource = observability?.bySource ?? [];
    return {
      document: bySource.find((item) => item.source === "document") ?? null,
      global: bySource.find((item) => item.source === "global") ?? null
    };
  }, [observability]);

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      const selected = Array.from(files ?? []);
      if (selected.length === 0) {
        return;
      }
      const token = await getToken();
      if (!token) {
        return;
      }
      setUploading(true);
      setFeedback(null);
      try {
        for (const file of selected) {
          await uploadAdminKnowledgeSource(token, "product", file);
        }
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Upload failed.");
      }
      setUploading(false);
    },
    [getToken, load]
  );

  const handleDelete = useCallback(
    async (sourceId: string) => {
      const token = await getToken();
      if (!token) {
        return;
      }
      setBusyId(sourceId);
      setFeedback(null);
      try {
        await deleteAdminKnowledgeSource(token, sourceId);
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Delete failed.");
      }
      setBusyId(null);
    },
    [getToken, load]
  );

  const handleReindex = useCallback(
    async (sourceId: string) => {
      const token = await getToken();
      if (!token) {
        return;
      }
      setBusyId(sourceId);
      setFeedback(null);
      try {
        await reindexAdminKnowledgeSource(token, sourceId);
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Reindex failed.");
      }
      setBusyId(null);
    },
    [getToken, load]
  );

  const handleSaveRetrievalPolicy = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      return;
    }
    setSavingPolicy(true);
    setFeedback(null);
    try {
      const nextPolicy = await updateAdminKnowledgeRetrievalPolicy(token, {
        embeddingModelKey: embeddingModelDraft.trim() || null,
        retrievalModelKey: retrievalModelDraft.trim() || null
      });
      setRetrievalPolicy(nextPolicy);
      setEmbeddingModelDraft(nextPolicy.embeddingModelKey ?? "");
      setRetrievalModelDraft(nextPolicy.retrievalModelKey ?? "");
      setFeedback(
        "Admin retrieval policy saved. Reindex Product KB and Skill documents to refresh embeddings."
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save retrieval policy.");
    }
    setSavingPolicy(false);
  }, [embeddingModelDraft, getToken, retrievalModelDraft]);

  return (
    <div className="mx-auto max-w-5xl space-y-3 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Library className="h-4 w-4 text-accent" />
          <div>
            <h1 className="text-sm font-bold tracking-tight text-text">Knowledge</h1>
            <p className="text-xs text-text-muted">
              Admin-owned PersAI Product KB, connectors, and retrieval observability.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Upload to Product KB
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleUploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-surface p-3 text-xs text-text-muted">
        <span className="rounded-lg bg-accent/10 px-3 py-1.5 text-accent">Product KB</span>
        <span className="text-[11px]">
          Professional Skill documents are managed under Admin &gt; Skills.
        </span>
        <span className="ml-auto">{sources.length} files</span>
        <span>{formatBytes(totalBytes)}</span>
      </div>

      <div className="rounded-xl border border-border/70 bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Admin retrieval models</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
              Used for admin-owned Product KB and Skill documents. User-uploaded assistant knowledge
              keeps using the assistant plan slots.
            </p>
          </div>
          <button
            type="button"
            disabled={savingPolicy}
            onClick={() => {
              void handleSaveRetrievalPolicy();
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {savingPolicy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save models
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
              Embedding index model
            </span>
            <ModelOptionSelect
              value={embeddingModelDraft}
              onChange={setEmbeddingModelDraft}
              options={availableModelKeys}
              placeholder="platform default"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
              Retrieval helper model
            </span>
            <ModelOptionSelect
              value={retrievalModelDraft}
              onChange={setRetrievalModelDraft}
              options={availableModelKeys}
              placeholder="platform default"
            />
          </label>
        </div>
        {retrievalPolicy?.notes.length ? (
          <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-text-muted">
            {retrievalPolicy.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border/70 bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wide text-text-subtle">Retrieval searches</p>
          <p className="mt-2 text-2xl font-semibold text-text">
            {observability?.totals.searchesTotal ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-text-muted">
            Updated {formatWhen(observability?.updatedAt ?? null)}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wide text-text-subtle">Empty result rate</p>
          <p className="mt-2 text-2xl font-semibold text-text">
            {formatPercent(observability?.totals.emptyRate ?? 0)}
          </p>
          <p className="mt-1 text-[11px] text-text-muted">
            Errors {formatPercent(observability?.totals.errorRate ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wide text-text-subtle">Hybrid share</p>
          <p className="mt-2 text-2xl font-semibold text-text">
            {formatPercent(observability?.totals.hybridRate ?? 0)}
          </p>
          <p className="mt-1 text-[11px] text-text-muted">
            Embedding queries {observability?.totals.embeddingQueryTotal ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wide text-text-subtle">Helper applied</p>
          <p className="mt-2 text-2xl font-semibold text-text">
            {observability?.totals.helperAppliedTotal ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-text-muted">
            Rate {formatPercent(observability?.totals.helperAppliedRate ?? 0)} · Tokens{" "}
            {observability?.totals.helperTotalTokensTotal ?? 0}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl border border-border/70 bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text">Retrieval quality</h2>
              <p className="text-xs text-text-muted">
                Live admin snapshot for the current knowledge retrieval path.
              </p>
            </div>
            <span className="text-[11px] text-text-subtle">
              Avg {Math.round(observability?.totals.avgDurationMs ?? 0)} ms · Fetch depth{" "}
              {Math.round(observability?.totals.avgFetchDepth ?? 0)}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-background px-3 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-subtle">Documents</p>
              <p className="mt-2 text-lg font-semibold text-text">
                {sourceSummaries.document?.searchesTotal ?? 0} searches
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                Empty {formatPercent(sourceSummaries.document?.emptyRate ?? 0)} · Hybrid{" "}
                {formatPercent(sourceSummaries.document?.hybridRate ?? 0)}
              </p>
            </div>
            <div className="rounded-lg bg-background px-3 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-subtle">Global KB</p>
              <p className="mt-2 text-lg font-semibold text-text">
                {sourceSummaries.global?.searchesTotal ?? 0} searches
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                Empty {formatPercent(sourceSummaries.global?.emptyRate ?? 0)} · Avg latency{" "}
                {Math.round(sourceSummaries.global?.avgDurationMs ?? 0)} ms
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {(observability?.recent ?? []).slice(0, 5).map((entry) => (
              <div
                key={`${entry.at}-${entry.source}-${entry.durationMs}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    {entry.source === "document"
                      ? "Document"
                      : entry.source === "global"
                        ? "Global"
                        : entry.source}{" "}
                    · {entry.eventKind} · {entry.retrievalMode}
                  </p>
                  <p className="text-text-muted">
                    {new Date(entry.at).toLocaleTimeString()} - {entry.resultCount} hits -{" "}
                    {entry.lexicalCandidateCount} lexical
                    {entry.vectorCandidateCount > 0
                      ? ` - ${entry.vectorCandidateCount} vector`
                      : ""}
                    {entry.fetchDepth > 0 ? ` - fetch ${entry.fetchDepth}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-text">{Math.round(entry.durationMs)} ms</p>
                  <p className="text-text-muted">
                    {entry.outcome}
                    {entry.helperApplied ? " - helper" : ""}
                    {entry.helperTotalTokens != null ? ` - ${entry.helperTotalTokens} tok` : ""}
                  </p>
                </div>
              </div>
            ))}
            {(observability?.recent?.length ?? 0) === 0 ? (
              <p className="text-xs text-text-muted">
                No retrieval samples yet. Open chat search or global knowledge search to populate
                this panel.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">External connectors</h2>
          <p className="mt-1 text-xs text-text-muted">
            Planned sync adapters for Product KB. They always land inside PersAI storage before
            indexing.
          </p>
          <div className="mt-4 space-y-3">
            {connectors.map((connector) => (
              <div key={connector.kind} className="rounded-lg border border-border/60 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">{connector.label}</p>
                  <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-text-muted">
                    {connector.status}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-text-muted">
                  {connector.syncMode.replaceAll("_", " ")}
                  {" -> "}
                  {connector.storageTarget.replaceAll("_", " ")}
                </p>
                <ul className="mt-2 space-y-1 text-[11px] text-text-muted">
                  {connector.pipeline.slice(0, 2).map((step) => (
                    <li key={step}>- {step}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {feedback ? <p className="text-xs text-destructive">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
        </div>
      ) : sources.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-surface p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-text-subtle" />
          <p className="mt-3 text-sm font-medium text-text">No files in this library yet</p>
          <p className="mt-1 text-xs text-text-muted">
            Upload shared docs here to keep PersAI-owned indexed copies for admin-managed knowledge.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sources.map((source) => {
            const isBusy = busyId === source.id;
            return (
              <li key={source.id} className="rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">
                      {source.displayName ?? source.originalFilename}
                    </p>
                    <p className="mt-1 text-[11px] text-text-subtle">
                      {source.originalFilename} · {formatBytes(source.sizeBytes)} ·{" "}
                      {source.chunkCount} chunks
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded-full bg-background px-2 py-0.5 text-text-muted">
                        product
                      </span>
                      <span className="rounded-full bg-background px-2 py-0.5 text-text-muted">
                        {source.status}
                      </span>
                    </div>
                    {source.lastErrorMessage ? (
                      <p className="mt-2 text-[11px] text-destructive">{source.lastErrorMessage}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleReindex(source.id)}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface hover:text-text disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDelete(source.id)}
                      className="rounded-lg border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
