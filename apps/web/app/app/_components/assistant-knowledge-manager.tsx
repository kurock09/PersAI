"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  deleteAssistantKnowledgeSource,
  getAssistantKnowledgeSources,
  inspectAssistantKnowledgeSource,
  reindexAssistantKnowledgeSource,
  uploadAssistantKnowledgeSource,
  type AssistantKnowledgeSourceInspectState,
  type AssistantKnowledgeSourceListState,
  type UploadedKnowledgeSource
} from "../assistant-api-client";
import { isKnowledgeEligibleFile } from "../chat-file-policy";
import { SlideOver } from "./slide-over";

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

export function AssistantKnowledgeManager(props: {
  getToken: () => Promise<string | null>;
  open?: boolean;
  onClose?: () => void;
  mode?: "drawer" | "inline";
}) {
  const t = useTranslations("settings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<AssistantKnowledgeSourceListState | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [inspectLoadingId, setInspectLoadingId] = useState<string | null>(null);
  const [inspectById, setInspectById] = useState<
    Record<string, AssistantKnowledgeSourceInspectState>
  >({});

  const mode = props.mode ?? "drawer";
  const isInline = mode === "inline";

  const load = useCallback(async () => {
    const token = await props.getToken();
    if (!token) {
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      setState(await getAssistantKnowledgeSources(token));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("knowledgeLoadFailed"));
    }
    setLoading(false);
  }, [props, t]);

  useEffect(() => {
    if (isInline || props.open) {
      void load();
    }
  }, [isInline, load, props.open]);

  const quotaLabel = useMemo(() => {
    const quota = state?.quota;
    if (!quota) {
      return null;
    }
    if (quota.limitBytes === null) {
      return t("knowledgeQuotaUsedOnly", { used: formatBytes(quota.usedBytes) });
    }
    return t("knowledgeQuotaUsage", {
      used: formatBytes(quota.usedBytes),
      limit: formatBytes(quota.limitBytes)
    });
  }, [state, t]);

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      const selected = Array.from(files ?? []).filter((file) => isKnowledgeEligibleFile(file));
      if (selected.length === 0) {
        setFeedback(t("knowledgeUploadInvalid"));
        return;
      }
      const token = await props.getToken();
      if (!token) {
        return;
      }
      setUploading(true);
      setFeedback(null);
      try {
        for (const file of selected) {
          await uploadAssistantKnowledgeSource(token, file);
        }
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : t("knowledgeUploadFailedStandalone"));
      }
      setUploading(false);
    },
    [load, props, t]
  );

  const handleDelete = useCallback(
    async (sourceId: string) => {
      const token = await props.getToken();
      if (!token) {
        return;
      }
      setBusyId(sourceId);
      setFeedback(null);
      try {
        await deleteAssistantKnowledgeSource(token, sourceId);
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : t("knowledgeDeleteFailed"));
      }
      setBusyId(null);
    },
    [load, props, t]
  );

  const handleReindex = useCallback(
    async (sourceId: string) => {
      const token = await props.getToken();
      if (!token) {
        return;
      }
      setBusyId(sourceId);
      setFeedback(null);
      try {
        await reindexAssistantKnowledgeSource(token, sourceId);
        await load();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : t("knowledgeReindexFailed"));
      }
      setBusyId(null);
    },
    [load, props, t]
  );

  const renderRow = (source: UploadedKnowledgeSource) => {
    const isBusy = busyId === source.id;
    const inspect = inspectById[source.id];
    const quality =
      inspect?.processingQuality !== null && inspect?.processingQuality !== undefined
        ? inspect.processingQuality
        : (source.processingQuality ?? null);
    const qualityStatus = typeof quality?.status === "string" ? quality.status : null;
    const qualityScore = typeof quality?.score === "number" ? quality.score : null;
    return (
      <li
        key={source.id}
        className={cn(
          "rounded-xl px-4 py-3",
          isInline ? "bg-background/42" : "border border-border/70 bg-surface-raised p-3"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text">
              {source.displayName ?? source.originalFilename}
            </p>
            <p className="mt-1 text-[11px] text-text-subtle">
              {source.originalFilename} · {formatBytes(source.sizeBytes)}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-full bg-background px-2 py-0.5 text-text-muted">
                {t(`knowledgeStatus.${source.status}` as never)}
              </span>
              <span className="rounded-full bg-background px-2 py-0.5 text-text-muted">
                {t("knowledgeChunks", { count: source.chunkCount })}
              </span>
              {qualityStatus ? (
                <span className="rounded-full bg-background px-2 py-0.5 text-text-muted">
                  {t("knowledgeInspectorQualityBadge", {
                    status: qualityStatus,
                    score: qualityScore === null ? "-" : qualityScore.toFixed(1)
                  })}
                </span>
              ) : null}
            </div>
            {source.lastErrorMessage ? (
              <p className="mt-2 text-[11px] text-destructive">{source.lastErrorMessage}</p>
            ) : null}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  const nextExpanded = expandedId === source.id ? null : source.id;
                  setExpandedId(nextExpanded);
                  if (nextExpanded === source.id && !inspectById[source.id]) {
                    void (async () => {
                      const token = await props.getToken();
                      if (!token) {
                        return;
                      }
                      setInspectLoadingId(source.id);
                      try {
                        const inspectState = await inspectAssistantKnowledgeSource(
                          token,
                          source.id
                        );
                        setInspectById((current) => ({ ...current, [source.id]: inspectState }));
                      } catch (error) {
                        setFeedback(
                          error instanceof Error ? error.message : t("knowledgeInspectorLoadFailed")
                        );
                      }
                      setInspectLoadingId(null);
                    })();
                  }
                }}
                className="text-[11px] text-text-muted underline-offset-2 hover:text-text hover:underline"
              >
                {expandedId === source.id
                  ? t("knowledgeInspectorHide")
                  : t("knowledgeInspectorShow")}
              </button>
            </div>
            {expandedId === source.id ? (
              <div
                className={cn(
                  "mt-3 rounded-lg p-3 text-[11px] text-text-muted",
                  isInline ? "bg-surface-raised/20" : "border border-border/70 bg-background"
                )}
              >
                {inspectLoadingId === source.id ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{t("knowledgeInspectorLoading")}</span>
                  </div>
                ) : inspect ? (
                  <div className="space-y-2">
                    <p>
                      {t("knowledgeInspectorStats", {
                        size: formatBytes(inspect.sizeBytes),
                        textChars: inspect.textChars,
                        chunkCount: inspect.chunkCount
                      })}
                    </p>
                    <p>
                      {t("knowledgeInspectorProcessor", {
                        processor: inspect.processorProviderKey ?? "-",
                        mode: inspect.processorMode ?? "-"
                      })}
                    </p>
                    {inspect.firstChunkPreview ? (
                      <p>
                        {t("knowledgeInspectorFirstChunk")}{" "}
                        <span className="text-text">"{inspect.firstChunkPreview}"</span>
                      </p>
                    ) : null}
                    <div className="space-y-1">
                      {inspect.chunks.map((chunk) => (
                        <p key={chunk.chunkIndex}>
                          #{chunk.chunkIndex} "{chunk.contentPreview}"
                          {chunk.looksLikeTocHeadingOnly
                            ? ` ${t("knowledgeInspectorTocOnly")}`
                            : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleReindex(source.id)}
              className="rounded-lg border border-border/55 px-2 py-1 text-[11px] text-text-muted hover:bg-surface hover:text-text disabled:opacity-50"
              title={t("knowledgeReindex")}
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
              className="rounded-lg border border-destructive/30 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
              title={t("knowledgeDelete")}
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
  };

  const content = (
    <div className={cn("space-y-4", isInline ? "px-1 py-1" : "p-5")}>
      <div className={cn(isInline ? "" : "rounded-2xl border border-border/70 bg-surface p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text">{t("knowledgeManagerTitle")}</p>
            <p className="mt-1 text-xs text-text-muted">{t("knowledgeManagerHelp")}</p>
            {quotaLabel ? <p className="mt-2 text-[11px] text-text-subtle">{quotaLabel}</p> : null}
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50",
              isInline
                ? "bg-accent text-white hover:bg-accent-hover"
                : "bg-accent text-white hover:bg-accent-hover"
            )}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {t("knowledgeUpload")}
          </button>
        </div>
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

      {feedback ? <p className="text-xs text-destructive">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
        </div>
      ) : state?.sources.length ? (
        <ul className="space-y-2.5">{state.sources.map(renderRow)}</ul>
      ) : (
        <div
          className={cn(
            "text-center",
            isInline
              ? "rounded-xl border border-dashed border-border/55 bg-background/30 p-5"
              : "rounded-2xl border border-dashed border-border/70 bg-surface p-6"
          )}
        >
          <FileText className="mx-auto h-8 w-8 text-text-subtle" />
          <p className="mt-3 text-sm font-medium text-text">{t("knowledgeEmptyTitle")}</p>
          <p className="mt-1 text-xs text-text-muted">{t("knowledgeEmptyBody")}</p>
        </div>
      )}
    </div>
  );

  if (isInline) {
    return content;
  }

  return (
    <SlideOver
      open={props.open ?? false}
      onClose={props.onClose ?? (() => undefined)}
      title={t("knowledgeManagerTitle")}
      size="narrow"
    >
      {content}
    </SlideOver>
  );
}
