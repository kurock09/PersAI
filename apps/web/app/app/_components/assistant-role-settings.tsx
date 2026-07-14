"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  getAssistantRole,
  getAssistantRoles,
  updateAssistantRole,
  type AssistantRoleSelectionState,
  type AssistantRoleState
} from "../assistant-api-client";
import { AssistantRoleCard, AssistantRoleSelector } from "./assistant-role-selector";

function mapRoleError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export function AssistantRoleSettings({
  assistantId,
  resolveAuthToken
}: {
  assistantId: string;
  resolveAuthToken: () => Promise<string | null>;
}) {
  const t = useTranslations("settings");
  const assistantRef = useRef(assistantId);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const [roles, setRoles] = useState<AssistantRoleState[] | null>(null);
  const [currentRole, setCurrentRole] = useState<AssistantRoleSelectionState | null>(null);
  const [draftRoleKey, setDraftRoleKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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
        const token = await resolveAuthToken();
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
    [isCurrent, resolveAuthToken, t]
  );

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
    setPickerOpen(false);
  }, [assistantId]);

  useEffect(() => {
    mountedRef.current = true;
    const expectedAssistantId = assistantId;
    const { generation, controller } = startGeneration();
    void loadCanonical({ expectedAssistantId, generation, controller });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [assistantId, loadCanonical, startGeneration]);

  const selectedRole = useMemo(() => {
    if (roles === null || draftRoleKey === null) {
      return null;
    }
    return roles.find((role) => role.key === draftRoleKey) ?? null;
  }, [draftRoleKey, roles]);

  const handleRetry = useCallback(() => {
    const expectedAssistantId = assistantRef.current;
    const { generation, controller } = startGeneration();
    setSaveFeedback(null);
    void loadCanonical({ expectedAssistantId, generation, controller });
  }, [loadCanonical, startGeneration]);

  const handleStartChange = useCallback(() => {
    setSaveFeedback(null);
    setSaveError(null);
    setDraftRoleKey(currentRole?.role.key ?? null);
    setPickerOpen(true);
  }, [currentRole?.role.key]);

  const handleCancelChange = useCallback(() => {
    setDraftRoleKey(currentRole?.role.key ?? null);
    setSaveError(null);
    setPickerOpen(false);
  }, [currentRole?.role.key]);

  const handleConfirmChange = useCallback(async () => {
    const nextRoleKey = draftRoleKey;
    if (!nextRoleKey || currentRole === null) {
      return;
    }
    if (nextRoleKey === currentRole.role.key) {
      setPickerOpen(false);
      setSaveError(null);
      return;
    }
    const expectedAssistantId = assistantRef.current;
    const { generation, controller } = startGeneration();
    setSaveBusy(true);
    setSaveError(null);
    setSaveFeedback(null);
    try {
      const token = await resolveAuthToken();
      if (!token || !isCurrent(expectedAssistantId, generation)) {
        if (isCurrent(expectedAssistantId, generation)) {
          setSaveError(t("roleSaveFailed"));
          await loadCanonical({
            expectedAssistantId,
            generation,
            controller,
            clearSaveError: false
          });
        }
        return;
      }
      const response = await updateAssistantRole(
        token,
        expectedAssistantId,
        { roleKey: nextRoleKey },
        controller.signal
      );
      if (
        !isCurrent(expectedAssistantId, generation) ||
        response.assistantId !== expectedAssistantId
      ) {
        if (isCurrent(expectedAssistantId, generation)) {
          setSaveError(t("roleSaveFailed"));
          await loadCanonical({
            expectedAssistantId,
            generation,
            controller,
            clearSaveError: false
          });
        }
        return;
      }
      const refetched = await loadCanonical({
        expectedAssistantId,
        generation,
        controller,
        clearSaveError: false,
        expectedRoleKey: nextRoleKey
      });
      if (!refetched) {
        if (isCurrent(expectedAssistantId, generation)) {
          setSaveError(t("roleSaveRefetchFailed"));
        }
        return;
      }
      if (isCurrent(expectedAssistantId, generation)) {
        setPickerOpen(false);
        setSaveError(null);
        setSaveFeedback(t("roleSaved"));
      }
    } catch (error) {
      if (!isCurrent(expectedAssistantId, generation)) {
        return;
      }
      await loadCanonical({
        expectedAssistantId,
        generation,
        controller,
        clearSaveError: false
      });
      if (isCurrent(expectedAssistantId, generation)) {
        setSaveError(mapRoleError(error, t("roleSaveFailed")));
      }
    } finally {
      if (isCurrent(expectedAssistantId, generation)) {
        setSaveBusy(false);
      }
    }
  }, [currentRole, draftRoleKey, isCurrent, loadCanonical, resolveAuthToken, startGeneration, t]);

  if (loading && currentRole === null && roles === null) {
    return (
      <AssistantRoleSelector
        roles={null}
        selectedRoleKey={null}
        onSelect={() => undefined}
        title={t("roleTitle")}
        description={t("roleDescription")}
        loading
      />
    );
  }

  if (currentRole === null || roles === null || loadError) {
    return (
      <AssistantRoleSelector
        roles={roles}
        selectedRoleKey={draftRoleKey}
        onSelect={() => undefined}
        title={t("roleTitle")}
        description={t("roleDescription")}
        error={loadError}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <div className="space-y-4">
      <AssistantRoleCard role={currentRole.role} selected={false} current />

      <div className="flex flex-wrap items-center gap-2">
        {!pickerOpen ? (
          <button
            type="button"
            onClick={handleStartChange}
            disabled={saveBusy}
            className="inline-flex items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
          >
            {t("changeRole")}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCancelChange}
              disabled={saveBusy}
              className="inline-flex items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-60"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmChange()}
              disabled={
                saveBusy || selectedRole === null || selectedRole.key === currentRole.role.key
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("saveRole")}
            </button>
          </>
        )}
      </div>

      {saveFeedback ? <p className="text-xs text-accent">{saveFeedback}</p> : null}
      {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}

      {pickerOpen ? (
        <AssistantRoleSelector
          roles={roles}
          selectedRoleKey={draftRoleKey}
          currentRoleKey={currentRole.role.key}
          onSelect={setDraftRoleKey}
          title={t("changeRoleTitle")}
          description={t("changeRoleDescription")}
          disabled={saveBusy}
          showCurrentMission={false}
        />
      ) : null}
    </div>
  );
}
