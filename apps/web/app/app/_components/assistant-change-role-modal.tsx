"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  getAssistantRole,
  getAssistantRoles,
  updateAssistantRole,
  type AssistantRoleSelectionState,
  type AssistantRoleState
} from "../assistant-api-client";
import {
  AssistantRoleDetailPane,
  resolveLocalizedRoleText,
  resolveRoleIconFallback
} from "./assistant-role-selector";
import { AssistantSettingsDialogShell } from "./assistant-settings-dialog-shell";
import { notifyAssistantRoleChanged } from "./use-assistant-live-role-name";

/** Previous fixed list column was 220px; default is +15%. */
export const ROLE_LIST_COLUMN_DEFAULT_PX = Math.round(220 * 1.15);
export const ROLE_LIST_COLUMN_MIN_PX = Math.round(ROLE_LIST_COLUMN_DEFAULT_PX * 0.8);
export const ROLE_LIST_COLUMN_MAX_PX = Math.round(ROLE_LIST_COLUMN_DEFAULT_PX * 1.2);

export function clampRoleListColumnWidthPx(widthPx: number): number {
  return Math.min(ROLE_LIST_COLUMN_MAX_PX, Math.max(ROLE_LIST_COLUMN_MIN_PX, Math.round(widthPx)));
}

function mapRoleError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

type MobilePane = "list" | "detail";

export function AssistantChangeRoleModal({
  open,
  assistantId,
  resolveAuthToken,
  onClose,
  onRoleChanged
}: {
  open: boolean;
  assistantId: string;
  resolveAuthToken: () => Promise<string | null>;
  onClose: () => void;
  onRoleChanged?: (() => void) | undefined;
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const messages = useMessages() as { assistantRole?: { categories?: Record<string, string> } };
  const assistantRef = useRef(assistantId);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const resolveAuthTokenRef = useRef(resolveAuthToken);

  const [roles, setRoles] = useState<AssistantRoleState[] | null>(null);
  const [currentRole, setCurrentRole] = useState<AssistantRoleSelectionState | null>(null);
  const [draftRoleKey, setDraftRoleKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [listColumnWidthPx, setListColumnWidthPx] = useState(ROLE_LIST_COLUMN_DEFAULT_PX);
  const [listResizeActive, setListResizeActive] = useState(false);
  const listResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setListColumnWidthPx(ROLE_LIST_COLUMN_DEFAULT_PX);
    setListResizeActive(false);
    listResizeRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!listResizeActive) {
      return;
    }
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [listResizeActive]);

  const handleListResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      listResizeRef.current = {
        startX: event.clientX,
        startWidth: listColumnWidthPx
      };
      setListResizeActive(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [listColumnWidthPx]
  );

  const handleListResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = listResizeRef.current;
    if (start === null) {
      return;
    }
    setListColumnWidthPx(
      clampRoleListColumnWidthPx(start.startWidth + (event.clientX - start.startX))
    );
  }, []);

  const handleListResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (listResizeRef.current === null) {
      return;
    }
    listResizeRef.current = null;
    setListResizeActive(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  const isCurrent = useCallback((expectedAssistantId: string, generation: number) => {
    return (
      mountedRef.current &&
      assistantRef.current === expectedAssistantId &&
      generationRef.current === generation
    );
  }, []);

  const startGeneration = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return { generation: generationRef.current, controller };
  }, []);

  const loadCanonical = useCallback(
    async ({
      expectedAssistantId,
      generation,
      controller,
      clearSaveError = true,
      expectedRoleKey
    }: {
      expectedAssistantId: string;
      generation: number;
      controller: AbortController;
      clearSaveError?: boolean;
      expectedRoleKey?: string;
    }): Promise<boolean> => {
      if (!isCurrent(expectedAssistantId, generation)) {
        return false;
      }
      setLoading(true);
      setLoadError(null);
      setRoles(null);
      setCurrentRole(null);
      if (clearSaveError) {
        setSaveError(null);
      }
      try {
        const token = await resolveAuthTokenRef.current();
        if (!token || !isCurrent(expectedAssistantId, generation)) {
          if (isCurrent(expectedAssistantId, generation)) {
            setLoadError(t("roleLoadFailed"));
          }
          return false;
        }
        const [catalog, current] = await Promise.all([
          getAssistantRoles(token, controller.signal),
          getAssistantRole(token, expectedAssistantId, controller.signal)
        ]);
        if (
          !isCurrent(expectedAssistantId, generation) ||
          current.assistantId !== expectedAssistantId
        ) {
          if (isCurrent(expectedAssistantId, generation)) {
            setLoadError(t("roleLoadFailed"));
          }
          return false;
        }
        const canonicalRole = catalog.roles.find(
          (role) => role.id === current.role.id && role.key === current.role.key
        );
        if (
          canonicalRole === undefined ||
          (expectedRoleKey !== undefined && canonicalRole.key !== expectedRoleKey)
        ) {
          setLoadError(t("roleLoadFailed"));
          return false;
        }
        setRoles(catalog.roles);
        setCurrentRole({ ...current, role: canonicalRole });
        setDraftRoleKey(canonicalRole.key);
        return true;
      } catch (error) {
        if (isCurrent(expectedAssistantId, generation)) {
          setRoles(null);
          setCurrentRole(null);
          setLoadError(mapRoleError(error, t("roleLoadFailed")));
        }
        return false;
      } finally {
        if (isCurrent(expectedAssistantId, generation)) {
          setLoading(false);
        }
      }
    },
    [isCurrent, t]
  );

  useLayoutEffect(() => {
    resolveAuthTokenRef.current = resolveAuthToken;
  }, [resolveAuthToken]);

  useLayoutEffect(() => {
    if (assistantRef.current !== assistantId) {
      assistantRef.current = assistantId;
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    }
    setRoles(null);
    setCurrentRole(null);
    setDraftRoleKey(null);
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveFeedback(null);
    setSaveBusy(false);
    setMobilePane("list");
  }, [assistantId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    mountedRef.current = true;
    const expectedAssistantId = assistantId;
    const { generation, controller } = startGeneration();
    setMobilePane("list");
    setSaveFeedback(null);
    setSaveError(null);
    void loadCanonical({ expectedAssistantId, generation, controller });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [open, assistantId, loadCanonical, startGeneration]);

  const selectedRole = useMemo(() => {
    if (roles === null || draftRoleKey === null) {
      return null;
    }
    return roles.find((role) => role.key === draftRoleKey) ?? null;
  }, [draftRoleKey, roles]);

  const handleSelectRole = useCallback((roleKey: string) => {
    setDraftRoleKey(roleKey);
    setSaveError(null);
    setSaveFeedback(null);
    setMobilePane("detail");
  }, []);

  const handleConfirmChange = useCallback(async () => {
    if (currentRole === null || draftRoleKey === null || selectedRole === null) {
      return;
    }
    if (selectedRole.key === currentRole.role.key) {
      onClose();
      return;
    }
    const expectedAssistantId = assistantRef.current;
    const { generation, controller } = startGeneration();
    setSaveBusy(true);
    setSaveError(null);
    setSaveFeedback(null);
    try {
      const token = await resolveAuthTokenRef.current();
      if (!token || !isCurrent(expectedAssistantId, generation)) {
        return;
      }
      const response = await updateAssistantRole(
        token,
        expectedAssistantId,
        { roleKey: draftRoleKey },
        controller.signal
      );
      if (!isCurrent(expectedAssistantId, generation)) {
        return;
      }
      if (response.assistantId !== expectedAssistantId) {
        setSaveError(t("roleSaveFailed"));
        return;
      }
      const confirmed = await loadCanonical({
        expectedAssistantId,
        generation,
        controller,
        clearSaveError: false,
        expectedRoleKey: draftRoleKey
      });
      if (!isCurrent(expectedAssistantId, generation)) {
        return;
      }
      if (!confirmed) {
        setSaveError(t("roleSaveRefetchFailed"));
        return;
      }
      setSaveFeedback(t("roleSaved"));
      notifyAssistantRoleChanged();
      onRoleChanged?.();
      onClose();
    } catch (error) {
      if (!isCurrent(expectedAssistantId, generation)) {
        return;
      }
      const recovered = await loadCanonical({
        expectedAssistantId,
        generation,
        controller,
        clearSaveError: false
      });
      if (!isCurrent(expectedAssistantId, generation)) {
        return;
      }
      setSaveError(
        recovered ? mapRoleError(error, t("roleSaveFailed")) : t("roleSaveRefetchFailed")
      );
    } finally {
      if (isCurrent(expectedAssistantId, generation)) {
        setSaveBusy(false);
      }
    }
  }, [
    currentRole,
    draftRoleKey,
    isCurrent,
    loadCanonical,
    onClose,
    onRoleChanged,
    selectedRole,
    startGeneration,
    t
  ]);

  const handleRetry = useCallback(() => {
    const expectedAssistantId = assistantRef.current;
    const { generation, controller } = startGeneration();
    void loadCanonical({ expectedAssistantId, generation, controller });
  }, [loadCanonical, startGeneration]);

  const detailTitle = selectedRole
    ? resolveLocalizedRoleText(selectedRole.name, locale, "Role")
    : t("changeRoleTitle");

  const footer = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-[1.25rem] text-xs">
        {saveError ? <p className="text-destructive">{saveError}</p> : null}
        {saveFeedback ? <p className="text-accent">{saveFeedback}</p> : null}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saveBusy}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-border/80 bg-transparent px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={() => void handleConfirmChange()}
          disabled={
            saveBusy ||
            loading ||
            selectedRole === null ||
            currentRole === null ||
            selectedRole.key === currentRole.role.key
          }
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("saveRole")}
        </button>
      </div>
    </div>
  );

  return (
    <AssistantSettingsDialogShell
      open={open}
      title={t("changeRoleTitle")}
      onClose={onClose}
      size="xl"
      closeDisabled={saveBusy}
      footer={footer}
      bodyClassName="!flex !min-h-0 !flex-1 !flex-col !overflow-hidden !p-0"
      leading={
        mobilePane === "detail" ? (
          <button
            type="button"
            onClick={() => setMobilePane("list")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text md:hidden"
            aria-label={t("changeRoleBackToList")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 px-5 py-10 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <span>{t("roleLoading")}</span>
        </div>
      ) : loadError ? (
        <div className="px-5 py-8">
          <p className="text-sm text-destructive">{loadError}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 inline-flex items-center rounded-xl border border-border/80 px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
          >
            {t("retry")}
          </button>
        </div>
      ) : roles === null || currentRole === null ? null : (
        <div className="flex h-full min-h-0 flex-1 flex-col md:flex-row">
          <div
            className={cn(
              "min-h-0 w-full overflow-y-auto overscroll-contain py-2 md:w-[var(--role-list-col-width)] md:shrink-0",
              mobilePane === "detail" ? "hidden md:block" : "block"
            )}
            style={{ ["--role-list-col-width" as string]: `${listColumnWidthPx}px` }}
            data-role-list-width={listColumnWidthPx}
          >
            <ul className="space-y-0.5 px-2" role="listbox" aria-label={t("changeRoleTitle")}>
              {roles.map((role) => {
                const title = resolveLocalizedRoleText(role.name, locale, "Role");
                const selected = role.key === draftRoleKey;
                const current = role.key === currentRole.role.key;
                return (
                  <li key={role.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => handleSelectRole(role.key)}
                      disabled={saveBusy}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "bg-accent/8 text-text"
                          : "text-text-muted hover:bg-surface-hover hover:text-text"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs",
                          selected ? "border-accent/30 bg-accent/10" : "border-border/60 bg-surface"
                        )}
                        aria-hidden="true"
                      >
                        {role.iconEmoji ?? resolveRoleIconFallback(title)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text">
                          {title}
                        </span>
                        {current ? (
                          <span className="block truncate text-[11px] text-text-subtle">
                            {t("roleCurrentBadge")}
                          </span>
                        ) : null}
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("changeRoleResizeList")}
            aria-valuemin={ROLE_LIST_COLUMN_MIN_PX}
            aria-valuemax={ROLE_LIST_COLUMN_MAX_PX}
            aria-valuenow={listColumnWidthPx}
            data-testid="change-role-list-resize-handle"
            className={cn(
              "relative hidden w-px shrink-0 cursor-col-resize touch-none select-none bg-border/50 md:block",
              listResizeActive ? "bg-border-strong" : "hover:bg-border-strong"
            )}
            onPointerDown={handleListResizePointerDown}
            onPointerMove={handleListResizePointerMove}
            onPointerUp={handleListResizePointerUp}
            onPointerCancel={handleListResizePointerUp}
          >
            <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
          </div>

          <div
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5",
              mobilePane === "list" ? "hidden md:block" : "block"
            )}
          >
            {selectedRole ? (
              <AssistantRoleDetailPane
                role={selectedRole}
                locale={locale}
                categoryLabels={messages.assistantRole?.categories}
                skillsTitle={t("roleConnectedSkills")}
                skillsEmpty={t("roleConnectedSkillsEmpty")}
                detailFallbackTitle={detailTitle}
              />
            ) : (
              <p className="text-sm text-text-muted">{t("changeRoleDescription")}</p>
            )}
          </div>
        </div>
      )}
    </AssistantSettingsDialogShell>
  );
}
