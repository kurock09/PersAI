"use client";

import { useAuth } from "@clerk/nextjs";
import { Loader2, Save, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/app/lib/utils";

type SitePageSlug = "terms" | "privacy" | "requisites" | "contacts";
type SitePageMarket = "rf" | "intl";
type SitePageLocale = "ru" | "en";
type SitePageStatus = "draft" | "published";

type SitePageState = {
  slug: SitePageSlug;
  market: SitePageMarket;
  locale: SitePageLocale;
  status: SitePageStatus;
  title: string;
  bodyMarkdown: string;
  version: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const SLUGS: SitePageSlug[] = ["terms", "privacy", "requisites", "contacts"];
const MARKETS: SitePageMarket[] = ["rf", "intl"];
const LOCALES: SitePageLocale[] = ["ru", "en"];

function entryKey(
  slug: SitePageSlug,
  market: SitePageMarket,
  locale: SitePageLocale,
  status: SitePageStatus
) {
  return `${slug}:${market}:${locale}:${status}`;
}

function requiresVersion(slug: SitePageSlug): boolean {
  return slug === "terms" || slug === "privacy";
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    const message =
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

export default function AdminSitePagesPage() {
  const { getToken } = useAuth();
  const [pages, setPages] = useState<SitePageState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<SitePageSlug>("terms");
  const [selectedMarket, setSelectedMarket] = useState<SitePageMarket>("rf");
  const [selectedLocale, setSelectedLocale] = useState<SitePageLocale>("ru");

  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [version, setVersion] = useState("");

  const saveDraftRequest = useCallback(
    async (token: string): Promise<SitePageState> => {
      const response = await fetch(`/api/v1/admin/site-pages/${selectedSlug}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          market: selectedMarket,
          locale: selectedLocale,
          title,
          bodyMarkdown,
          version: requiresVersion(selectedSlug) ? version || null : null
        })
      });
      const payload = await parseJson<{ page: SitePageState }>(response);
      return payload.page;
    },
    [bodyMarkdown, selectedLocale, selectedMarket, selectedSlug, title, version]
  );

  const mergePage = useCallback((nextPage: SitePageState) => {
    setPages((current) => {
      const next = current.filter(
        (page) =>
          entryKey(page.slug, page.market, page.locale, page.status) !==
          entryKey(nextPage.slug, nextPage.market, nextPage.locale, nextPage.status)
      );
      return [...next, nextPage];
    });
  }, []);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) {
        throw new Error("Session expired. Sign in again.");
      }
      const response = await fetch("/api/v1/admin/site-pages", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const payload = await parseJson<{ pages: SitePageState[] }>(response);
      setPages(payload.pages);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load site pages.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchPages();
  }, [fetchPages]);

  const pagesByKey = useMemo(() => {
    const map = new Map<string, SitePageState>();
    for (const page of pages) {
      map.set(entryKey(page.slug, page.market, page.locale, page.status), page);
    }
    return map;
  }, [pages]);

  const selectedDraft =
    pagesByKey.get(entryKey(selectedSlug, selectedMarket, selectedLocale, "draft")) ?? null;
  const selectedPublished =
    pagesByKey.get(entryKey(selectedSlug, selectedMarket, selectedLocale, "published")) ?? null;

  useEffect(() => {
    const source = selectedDraft ?? selectedPublished;
    setTitle(source?.title ?? "");
    setBodyMarkdown(source?.bodyMarkdown ?? "");
    setVersion(source?.version ?? "");
    setNotice(null);
  }, [selectedDraft, selectedPublished]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) {
        throw new Error("Session expired. Sign in again.");
      }
      mergePage(await saveDraftRequest(token));
      setNotice("Draft saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  }, [getToken, mergePage, saveDraftRequest]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) {
        throw new Error("Session expired. Sign in again.");
      }
      mergePage(await saveDraftRequest(token));
      const response = await fetch(`/api/v1/admin/site-pages/${selectedSlug}/publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          market: selectedMarket,
          locale: selectedLocale
        })
      });
      const payload = await parseJson<{ page: SitePageState }>(response);
      mergePage(payload.page);
      setNotice("Published.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to publish page.");
    } finally {
      setPublishing(false);
    }
  }, [getToken, mergePage, saveDraftRequest, selectedLocale, selectedMarket, selectedSlug]);

  return (
    <main className="space-y-6 px-4 py-6 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Site Pages</h1>
        <p className="max-w-3xl text-sm text-text-muted">
          Manage public legal and trust pages by slug, market, and locale. Save to draft first, then
          publish when the text is ready for production.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-text-subtle">
                Page
              </span>
              <select
                value={selectedSlug}
                onChange={(event) => setSelectedSlug(event.target.value as SitePageSlug)}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none"
              >
                {SLUGS.map((slug) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-text-subtle">
                Market
              </span>
              <select
                value={selectedMarket}
                onChange={(event) => setSelectedMarket(event.target.value as SitePageMarket)}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none"
              >
                {MARKETS.map((market) => (
                  <option key={market} value={market}>
                    {market}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-text-subtle">
                Locale
              </span>
              <select
                value={selectedLocale}
                onChange={(event) => setSelectedLocale(event.target.value as SitePageLocale)}
                className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none"
              >
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {locale}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6 space-y-2 text-xs text-text-muted">
            <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
              <span>Draft</span>
              <span className={cn(selectedDraft ? "text-text" : "text-text-subtle")}>
                {selectedDraft ? new Date(selectedDraft.updatedAt).toLocaleString() : "missing"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
              <span>Published</span>
              <span className={cn(selectedPublished ? "text-text" : "text-text-subtle")}>
                {selectedPublished?.publishedAt
                  ? new Date(selectedPublished.publishedAt).toLocaleString()
                  : "missing"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {notice}
                </div>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-text-subtle">
                  Title
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none"
                />
              </label>

              {requiresVersion(selectedSlug) ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-text-subtle">
                    Version
                  </span>
                  <input
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="rf:persai_tos_v1"
                    className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none"
                  />
                </label>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-text-subtle">
                  Markdown
                </span>
                <textarea
                  value={bodyMarkdown}
                  onChange={(event) => setBodyMarkdown(event.target.value)}
                  rows={20}
                  className="min-h-[420px] w-full rounded-2xl border border-border bg-surface-raised px-3 py-3 text-sm text-text outline-none"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || publishing}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={() => void handlePublish()}
                  disabled={saving || publishing}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {publishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Publish
                </button>
                <button
                  type="button"
                  onClick={() => void fetchPages()}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-transparent px-4 py-2 text-sm font-medium text-text-muted"
                >
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
