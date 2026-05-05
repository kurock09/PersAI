"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Wrench, Loader2, Save, CheckCircle, XCircle, FileText, PlugZap } from "lucide-react";

type ProviderOption = {
  id: string;
  label: string;
  envVar: string;
};

type ToolCredentialStatus = {
  credentialKey: string;
  toolCode: string;
  displayName: string;
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
  providerId: string | null;
  providerOptions: ProviderOption[] | null;
};

type AdminToolCredentialsState = {
  schema: string;
  credentials: ToolCredentialStatus[];
  ttsPrimaryProviderId: string;
  ttsPrimaryProviderOptions: ProviderOption[];
  notes: string[];
};

type DocumentProcessingProviderKey = "local" | "mistral" | "llamaparse";

type DocumentProcessingPolicyState = {
  defaultProvider: DocumentProcessingProviderKey;
  highQualityFallbackProvider: DocumentProcessingProviderKey;
  localFallbackEnabled: boolean;
  autoFallbackEnabled: boolean;
  needsReviewThreshold: number;
};

type DocumentProcessingProviderState = {
  providerKey: DocumentProcessingProviderKey;
  enabled: boolean;
  configured: boolean;
  role: "local_fallback" | "default_provider" | "high_quality_fallback";
  lastFour: string | null;
  updatedAt: string | null;
};

type AdminDocumentProcessingSettingsState = {
  policy: DocumentProcessingPolicyState;
  providers: DocumentProcessingProviderState[];
  notes: string[];
};

type BillingProviderCredentialStatus = {
  providerKey: "cloudpayments";
  displayName: "CloudPayments";
  apiSecret: {
    configured: boolean;
    lastFour: string | null;
    updatedAt: string | null;
  };
  publicTerminalId: {
    configured: boolean;
    lastFour: string | null;
    updatedAt: string | null;
  };
  description: string;
};

type AdminBillingProviderCredentialsState = {
  schema: string;
  providers: BillingProviderCredentialStatus[];
  notes: string[];
};

export default function AdminToolsPage() {
  const { getToken } = useAuth();
  const [state, setState] = useState<AdminToolCredentialsState | null>(null);
  const [billingState, setBillingState] = useState<AdminBillingProviderCredentialsState | null>(
    null
  );
  const [documentProcessingState, setDocumentProcessingState] =
    useState<AdminDocumentProcessingSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBilling, setSavingBilling] = useState(false);
  const [savingDocumentProcessing, setSavingDocumentProcessing] = useState(false);
  const [testingProvider, setTestingProvider] = useState<DocumentProcessingProviderKey | null>(
    null
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [billingFeedback, setBillingFeedback] = useState<string | null>(null);
  const [documentProcessingFeedback, setDocumentProcessingFeedback] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [billingKeyInputs, setBillingKeyInputs] = useState<{
    cloudpaymentsApiSecret?: string;
    cloudpaymentsPublicTerminalId?: string;
  }>({});
  const [providerInputs, setProviderInputs] = useState<Record<string, string>>({});
  const [ttsPrimaryProviderInput, setTtsPrimaryProviderInput] = useState<string | null>(null);
  const [documentProcessingPolicyInput, setDocumentProcessingPolicyInput] =
    useState<DocumentProcessingPolicyState | null>(null);
  const [documentProcessingThresholdInput, setDocumentProcessingThresholdInput] =
    useState<string>("0.65");
  const [documentProcessingKeyInputs, setDocumentProcessingKeyInputs] = useState<
    Partial<Record<"mistral" | "llamaparse", string>>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setFeedback("Session expired. Please sign in again.");
        return;
      }
      const res = await fetch("/api/v1/admin/runtime/tool-credentials", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const data = await res.json();
      setState(data.credentials ?? data);
      const billingRes = await fetch("/api/v1/admin/tools/billing", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!billingRes.ok)
        throw new Error(`Failed to load billing credentials: ${billingRes.status}`);
      const billingData = await billingRes.json();
      setBillingState(billingData.settings ?? billingData);
      const docRes = await fetch("/api/v1/admin/tools/document-processing", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!docRes.ok) throw new Error(`Failed to load document processing: ${docRes.status}`);
      const docData = await docRes.json();
      const settings = docData.settings ?? docData;
      setDocumentProcessingState(settings);
      setDocumentProcessingPolicyInput(settings.policy);
      setDocumentProcessingThresholdInput(String(settings.policy.needsReviewThreshold));
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setFeedback(null);
    try {
      const challengeRes = await fetch("/api/v1/admin/step-up/challenge", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "admin.tool_credentials.update" })
      });
      if (!challengeRes.ok) throw new Error("Step-up challenge failed.");
      const challengeData = await challengeRes.json();
      const stepUpToken = challengeData.challenge?.token ?? challengeData.token;

      const keysToSend: Record<string, string> = {};
      for (const [key, value] of Object.entries(keyInputs)) {
        if (value.trim()) keysToSend[key] = value.trim();
      }

      const providersToSend: Record<string, string> = {};
      for (const [key, value] of Object.entries(providerInputs)) {
        if (value.trim()) providersToSend[key] = value.trim();
      }

      const nextTtsPrimaryProviderId =
        ttsPrimaryProviderInput !== null &&
        ttsPrimaryProviderInput !== (state?.ttsPrimaryProviderId ?? null)
          ? ttsPrimaryProviderInput
          : undefined;

      if (
        Object.keys(keysToSend).length === 0 &&
        Object.keys(providersToSend).length === 0 &&
        nextTtsPrimaryProviderId === undefined
      ) {
        setFeedback("No changes to save.");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/v1/admin/runtime/tool-credentials", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-persai-step-up-token": stepUpToken
        },
        body: JSON.stringify({
          keys: keysToSend,
          providers: providersToSend,
          ...(nextTtsPrimaryProviderId === undefined
            ? {}
            : { ttsPrimaryProviderId: nextTtsPrimaryProviderId })
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Save failed: ${res.status}`);
      }
      setFeedback("Saved successfully.");
      setKeyInputs({});
      setProviderInputs({});
      setTtsPrimaryProviderInput(null);
      await load();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Save failed.");
    }
    setSaving(false);
  }, [getToken, keyInputs, providerInputs, ttsPrimaryProviderInput, state, load]);

  const handleSaveBilling = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setBillingFeedback("Session expired. Please sign in again.");
      return;
    }
    setSavingBilling(true);
    setBillingFeedback(null);
    try {
      const challengeRes = await fetch("/api/v1/admin/step-up/challenge", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "admin.billing_provider_credentials.update" })
      });
      if (!challengeRes.ok) {
        const err = await challengeRes.json().catch(() => ({}));
        throw new Error(readErrorMessage(err) ?? "Step-up challenge failed.");
      }
      const challengeData = await challengeRes.json();
      const stepUpToken = challengeData.challenge?.token ?? challengeData.token;

      const providers: Record<string, { apiSecret?: string; publicTerminalId?: string }> = {};
      const cloudpaymentsApiSecret = billingKeyInputs.cloudpaymentsApiSecret?.trim() ?? "";
      const cloudpaymentsPublicTerminalId =
        billingKeyInputs.cloudpaymentsPublicTerminalId?.trim() ?? "";
      if (cloudpaymentsApiSecret.length > 0 || cloudpaymentsPublicTerminalId.length > 0) {
        providers.cloudpayments = {
          ...(cloudpaymentsApiSecret.length > 0 ? { apiSecret: cloudpaymentsApiSecret } : {}),
          ...(cloudpaymentsPublicTerminalId.length > 0
            ? { publicTerminalId: cloudpaymentsPublicTerminalId }
            : {})
        };
      }
      if (Object.keys(providers).length === 0) {
        setBillingFeedback("No billing credential changes to save.");
        setSavingBilling(false);
        return;
      }

      const res = await fetch("/api/v1/admin/tools/billing", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-persai-step-up-token": stepUpToken
        },
        body: JSON.stringify({ providers })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(readErrorMessage(err) ?? `Save failed: ${res.status}`);
      }
      setBillingFeedback("Billing credentials saved.");
      setBillingKeyInputs({});
      await load();
    } catch (e) {
      setBillingFeedback(e instanceof Error ? e.message : "Save failed.");
    }
    setSavingBilling(false);
  }, [billingKeyInputs, getToken, load]);

  const handleSaveDocumentProcessing = useCallback(async () => {
    const token = await getToken();
    if (!token || !documentProcessingPolicyInput) {
      setDocumentProcessingFeedback("Session expired. Please sign in again.");
      return;
    }
    setSavingDocumentProcessing(true);
    setDocumentProcessingFeedback(null);
    try {
      const needsReviewThreshold = parseDecimalInput(documentProcessingThresholdInput);
      if (needsReviewThreshold === null || needsReviewThreshold < 0 || needsReviewThreshold > 1) {
        throw new Error("Needs-review threshold must be a number between 0 and 1.");
      }
      if (
        documentProcessingPolicyInput.defaultProvider ===
        documentProcessingPolicyInput.highQualityFallbackProvider
      ) {
        throw new Error("Default provider and high-quality fallback must differ.");
      }
      for (const providerKey of requiredRemoteDocumentProviders(documentProcessingPolicyInput)) {
        const provider = documentProcessingState?.providers.find(
          (item) => item.providerKey === providerKey
        );
        const incomingKey = documentProcessingKeyInputs[providerKey]?.trim() ?? "";
        if (!provider?.configured && incomingKey.length === 0) {
          throw new Error(
            `${providerLabel(providerKey)} API key is required for the selected policy.`
          );
        }
      }
      const challengeRes = await fetch("/api/v1/admin/step-up/challenge", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "admin.document_processing_settings.update" })
      });
      if (!challengeRes.ok) {
        const err = await challengeRes.json().catch(() => ({}));
        throw new Error(
          readErrorMessage(err) ?? `Step-up challenge failed: ${challengeRes.status}`
        );
      }
      const challengeData = await challengeRes.json();
      const stepUpToken = challengeData.challenge?.token ?? challengeData.token;

      const providerKeys: Partial<Record<"mistral" | "llamaparse", string>> = {};
      for (const [providerKey, value] of Object.entries(documentProcessingKeyInputs)) {
        if (value.trim()) {
          providerKeys[providerKey as "mistral" | "llamaparse"] = value.trim();
        }
      }

      const res = await fetch("/api/v1/admin/tools/document-processing", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-persai-step-up-token": stepUpToken
        },
        body: JSON.stringify({
          policy: {
            ...documentProcessingPolicyInput,
            needsReviewThreshold
          },
          providerKeys
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(readErrorMessage(err) ?? `Save failed: ${res.status}`);
      }
      setDocumentProcessingFeedback("Document processing settings saved.");
      setDocumentProcessingKeyInputs({});
      await load();
    } catch (e) {
      setDocumentProcessingFeedback(e instanceof Error ? e.message : "Save failed.");
    }
    setSavingDocumentProcessing(false);
  }, [
    documentProcessingKeyInputs,
    documentProcessingPolicyInput,
    documentProcessingState?.providers,
    documentProcessingThresholdInput,
    getToken,
    load
  ]);

  const handleTestDocumentProvider = useCallback(
    async (providerKey: DocumentProcessingProviderKey) => {
      const token = await getToken();
      if (!token) {
        setDocumentProcessingFeedback("Session expired. Please sign in again.");
        return;
      }
      setTestingProvider(providerKey);
      setDocumentProcessingFeedback(null);
      try {
        const providerKeyCandidate =
          providerKey === "mistral" || providerKey === "llamaparse"
            ? documentProcessingKeyInputs[providerKey]?.trim() || null
            : null;
        const res = await fetch("/api/v1/admin/tools/document-processing/test-connection", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ providerKey, providerKeyCandidate })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(readErrorMessage(err) ?? `Connection test failed: ${res.status}`);
        }
        const data = await res.json();
        const result = data.result;
        setDocumentProcessingFeedback(`${providerLabel(providerKey)}: ${result.message}`);
      } catch (e) {
        setDocumentProcessingFeedback(e instanceof Error ? e.message : "Connection test failed.");
      }
      setTestingProvider(null);
    },
    [documentProcessingKeyInputs, getToken]
  );

  const updateKeyInput = (credentialKey: string, value: string) => {
    setKeyInputs((prev) => ({ ...prev, [credentialKey]: value }));
  };

  const updateProviderInput = (credentialKey: string, value: string) => {
    setProviderInputs((prev) => ({ ...prev, [credentialKey]: value }));
  };

  const updateDocumentPolicy = (patch: Partial<DocumentProcessingPolicyState>) => {
    setDocumentProcessingPolicyInput((prev) => (prev === null ? prev : { ...prev, ...patch }));
  };

  const updateDocumentThresholdInput = (value: string) => {
    setDocumentProcessingThresholdInput(value);
    const next = parseDecimalInput(value);
    if (next !== null && next >= 0 && next <= 1) {
      updateDocumentPolicy({ needsReviewThreshold: next });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Wrench className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-bold text-text">Tools</h1>
      </div>

      {state && state.notes.length > 0 && (
        <div className="mb-6 space-y-1">
          <ul className="list-disc pl-4 text-xs text-text-subtle">
            {state.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="max-w-2xl space-y-8">
        {documentProcessingState && documentProcessingPolicyInput && (
          <section className="rounded-xl border border-border bg-surface-raised p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-accent" />
                <div>
                  <p className="text-sm font-semibold text-text">Document Processing</p>
                  <p className="text-[11px] text-text-muted">
                    Configure OCR/parser providers for Knowledge and future Skill documents.
                  </p>
                </div>
              </div>
            </div>

            {documentProcessingState.notes.length > 0 && (
              <ul className="mb-4 list-disc space-y-1 pl-4 text-[11px] text-text-subtle">
                {documentProcessingState.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-text-muted">Default provider</span>
                <select
                  value={documentProcessingPolicyInput.defaultProvider}
                  onChange={(e) =>
                    updateDocumentPolicy({
                      defaultProvider: e.target.value as DocumentProcessingProviderKey
                    })
                  }
                  className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                >
                  <option value="local">Local parser</option>
                  <option value="mistral">Mistral OCR</option>
                  <option value="llamaparse">LlamaParse</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-text-muted">
                  High-quality fallback
                </span>
                <select
                  value={documentProcessingPolicyInput.highQualityFallbackProvider}
                  onChange={(e) =>
                    updateDocumentPolicy({
                      highQualityFallbackProvider: e.target.value as DocumentProcessingProviderKey
                    })
                  }
                  className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                >
                  <option value="mistral">Mistral OCR</option>
                  <option value="llamaparse">LlamaParse</option>
                </select>
              </label>

              <label className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-xs text-text">
                <input
                  type="checkbox"
                  checked={documentProcessingPolicyInput.localFallbackEnabled}
                  onChange={(e) => updateDocumentPolicy({ localFallbackEnabled: e.target.checked })}
                />
                Local fallback enabled
              </label>

              <label className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-xs text-text">
                <input
                  type="checkbox"
                  checked={documentProcessingPolicyInput.autoFallbackEnabled}
                  onChange={(e) => updateDocumentPolicy({ autoFallbackEnabled: e.target.checked })}
                />
                Auto high-quality fallback
              </label>

              <label className="block md:col-span-2">
                <span className="mb-1 block text-[11px] text-text-muted">
                  Needs-review threshold
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={documentProcessingThresholdInput}
                  onChange={(e) => updateDocumentThresholdInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(["mistral", "llamaparse"] as const).map((providerKey) => {
                const provider = documentProcessingState.providers.find(
                  (item) => item.providerKey === providerKey
                );
                return (
                  <div key={providerKey} className="rounded-lg border border-border bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-text">
                          {providerLabel(providerKey)}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {provider?.role ?? "provider"}
                        </p>
                      </div>
                      {provider?.configured ? (
                        <span className="text-[11px] text-success">Configured</span>
                      ) : (
                        <span className="text-[11px] text-text-subtle">Not set</span>
                      )}
                    </div>
                    <input
                      type="password"
                      value={documentProcessingKeyInputs[providerKey] ?? ""}
                      onChange={(e) =>
                        setDocumentProcessingKeyInputs((prev) => ({
                          ...prev,
                          [providerKey]: e.target.value
                        }))
                      }
                      placeholder={
                        provider?.configured ? `••••${provider.lastFour ?? ""}` : "Enter API key..."
                      }
                      className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                    />
                    {provider?.updatedAt && (
                      <p className="mt-1 text-[10px] text-text-muted">
                        Last updated: {new Date(provider.updatedAt).toLocaleString()}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleTestDocumentProvider(providerKey)}
                      disabled={testingProvider === providerKey}
                      className="mt-2 flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:border-border-strong disabled:opacity-50"
                    >
                      {testingProvider === providerKey ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <PlugZap className="h-3 w-3" />
                      )}
                      Test connection
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              disabled={savingDocumentProcessing}
              onClick={() => void handleSaveDocumentProcessing()}
              className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {savingDocumentProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save document processing
            </button>
            {documentProcessingFeedback && (
              <p className="mt-2 text-xs text-text-muted">{documentProcessingFeedback}</p>
            )}
          </section>
        )}

        {billingState && (
          <section className="rounded-xl border border-border bg-surface-raised p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-accent" />
                <div>
                  <p className="text-sm font-semibold text-text">Billing Providers</p>
                  <p className="text-[11px] text-text-muted">
                    Encrypted credentials for payment-provider verification and future billing API
                    calls.
                  </p>
                </div>
              </div>
            </div>

            {billingState.notes.length > 0 && (
              <ul className="mb-4 list-disc space-y-1 pl-4 text-[11px] text-text-subtle">
                {billingState.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}

            <div className="space-y-3">
              {billingState.providers.map((provider) => (
                <div
                  key={provider.providerKey}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-text">{provider.displayName}</p>
                      <p className="text-[11px] text-text-muted">{provider.description}</p>
                    </div>
                    {provider.apiSecret.configured && provider.publicTerminalId.configured ? (
                      <span className="text-[11px] text-success">Configured</span>
                    ) : (
                      <span className="text-[11px] text-text-subtle">Incomplete</span>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-medium text-text">API Secret</p>
                      <input
                        type="password"
                        value={billingKeyInputs.cloudpaymentsApiSecret ?? ""}
                        onChange={(e) =>
                          setBillingKeyInputs((prev) => ({
                            ...prev,
                            cloudpaymentsApiSecret: e.target.value
                          }))
                        }
                        placeholder={
                          provider.apiSecret.configured
                            ? `••••${provider.apiSecret.lastFour ?? ""}`
                            : "Enter API secret..."
                        }
                        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                      />
                      {provider.apiSecret.updatedAt && (
                        <p className="mt-1 text-[10px] text-text-muted">
                          Last updated: {new Date(provider.apiSecret.updatedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-medium text-text">Public Terminal ID</p>
                      <input
                        type="text"
                        value={billingKeyInputs.cloudpaymentsPublicTerminalId ?? ""}
                        onChange={(e) =>
                          setBillingKeyInputs((prev) => ({
                            ...prev,
                            cloudpaymentsPublicTerminalId: e.target.value
                          }))
                        }
                        placeholder={
                          provider.publicTerminalId.configured
                            ? `••••${provider.publicTerminalId.lastFour ?? ""}`
                            : "Enter public terminal id..."
                        }
                        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
                      />
                      {provider.publicTerminalId.updatedAt && (
                        <p className="mt-1 text-[10px] text-text-muted">
                          Last updated:{" "}
                          {new Date(provider.publicTerminalId.updatedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              disabled={savingBilling}
              onClick={() => void handleSaveBilling()}
              className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {savingBilling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save billing credentials
            </button>
            {billingFeedback && <p className="mt-2 text-xs text-text-muted">{billingFeedback}</p>}
          </section>
        )}

        <section className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-text">Tool Credentials</p>
            <p className="text-[11px] text-text-muted">
              API keys for runtime tools such as browser, web search, images, memory, and TTS.
            </p>
          </div>
          {state && state.ttsPrimaryProviderOptions.length > 0 && (
            <div className="rounded-lg border border-border bg-surface-raised p-4">
              <div className="mb-2">
                <p className="text-sm font-medium text-text">TTS primary provider</p>
                <p className="text-[11px] text-text-muted">
                  PersAI will try this provider first for the `tts` tool, then fall back.
                </p>
              </div>
              <select
                value={ttsPrimaryProviderInput ?? state.ttsPrimaryProviderId}
                onChange={(e) => setTtsPrimaryProviderInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
              >
                {state.ttsPrimaryProviderOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {state?.credentials.map((cred) => (
            <div
              key={cred.credentialKey}
              className="rounded-lg border border-border bg-surface-raised p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-medium text-text">{cred.displayName}</p>
                  <p className="text-[11px] text-text-muted">
                    Tool: <span className="font-mono">{cred.toolCode}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {cred.configured ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5 text-success" />
                      <span className="text-[11px] text-success">Configured</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-text-subtle" />
                      <span className="text-[11px] text-text-subtle">Not set</span>
                    </>
                  )}
                </div>
              </div>
              {cred.providerOptions && cred.providerOptions.length > 1 && (
                <div className="mb-2">
                  <label className="text-[11px] text-text-muted block mb-1">Provider</label>
                  <select
                    value={providerInputs[cred.credentialKey] ?? cred.providerId ?? ""}
                    onChange={(e) => updateProviderInput(cred.credentialKey, e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                  >
                    {cred.providerOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <input
                type="password"
                value={keyInputs[cred.credentialKey] ?? ""}
                onChange={(e) => updateKeyInput(cred.credentialKey, e.target.value)}
                placeholder={cred.configured ? `••••${cred.lastFour ?? ""}` : "Enter API key..."}
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
              />
              {cred.updatedAt && (
                <p className="mt-1 text-[10px] text-text-muted">
                  Last updated: {new Date(cred.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
          ))}

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save credentials
          </button>

          {feedback && <p className="text-xs text-text-muted mt-2">{feedback}</p>}
        </section>
      </div>
    </div>
  );
}

function providerLabel(providerKey: DocumentProcessingProviderKey): string {
  if (providerKey === "local") return "Local parser";
  return providerKey === "mistral" ? "Mistral OCR" : "LlamaParse";
}

function requiredRemoteDocumentProviders(
  policy: DocumentProcessingPolicyState
): Array<"mistral" | "llamaparse"> {
  const providers = new Set<"mistral" | "llamaparse">();
  if (policy.defaultProvider === "mistral" || policy.defaultProvider === "llamaparse") {
    providers.add(policy.defaultProvider);
  }
  if (
    policy.highQualityFallbackProvider === "mistral" ||
    policy.highQualityFallbackProvider === "llamaparse"
  ) {
    providers.add(policy.highQualityFallbackProvider);
  }
  return [...providers];
}

function parseDecimalInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized.length === 0) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readErrorMessage(value: unknown): string | null {
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.message === "string" && row.message.trim().length > 0) {
      return row.message;
    }
    const nested = row.error;
    if (nested !== null && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message;
      }
    }
  }
  return null;
}
