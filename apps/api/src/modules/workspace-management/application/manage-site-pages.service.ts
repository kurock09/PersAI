import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { resolveLegalMarket } from "@persai/types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { normalizeLocaleInput } from "../../identity-access/application/locale-resolution";
import type {
  PublicSitePageState,
  SitePageLocale,
  SitePageMarket,
  SitePageSlug,
  SitePageState,
  SitePageVariantState
} from "./site-page.types";
import { SITE_PAGE_LOCALES, SITE_PAGE_MARKETS, SITE_PAGE_SLUGS } from "./site-page.types";

type SitePageRow = {
  slug: string;
  market: string;
  locale: string;
  status: string;
  title: string;
  bodyMarkdown: string;
  version: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

interface SaveDraftInput {
  market: SitePageMarket;
  locale: SitePageLocale;
  title: string;
  bodyMarkdown: string;
  version: string | null;
}

interface PublishInput {
  market: SitePageMarket;
  locale: SitePageLocale;
}

function isSitePageSlug(value: string): value is SitePageSlug {
  return (SITE_PAGE_SLUGS as readonly string[]).includes(value);
}

function isSitePageMarket(value: string): value is SitePageMarket {
  return (SITE_PAGE_MARKETS as readonly string[]).includes(value);
}

function isSitePageLocale(value: string): value is SitePageLocale {
  return (SITE_PAGE_LOCALES as readonly string[]).includes(value);
}

function parseNullableVersion(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("version must be a non-empty string or null.");
  }
  const normalized = value.trim();
  if (normalized.length > 64) {
    throw new BadRequestException("version must be at most 64 characters.");
  }
  return normalized;
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function parseCookieValue(
  rawCookieHeader: string | string[] | undefined,
  key: string
): string | null {
  const source =
    typeof rawCookieHeader === "string"
      ? rawCookieHeader
      : Array.isArray(rawCookieHeader)
        ? rawCookieHeader.join("; ")
        : "";
  if (!source) {
    return null;
  }
  const parts = source.split(/;\s*/);
  for (const part of parts) {
    if (!part.startsWith(`${key}=`)) continue;
    const rawValue = part.slice(key.length + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return null;
  }
  if (normalized === "XX" || normalized === "ZZ") {
    return null;
  }
  return normalized;
}

function inferCountryCodeFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const candidates = [
    headers["cf-ipcountry"],
    headers["x-vercel-ip-country"],
    headers["x-country-code"],
    headers["cloudfront-viewer-country"]
  ];
  for (const candidate of candidates) {
    const raw = Array.isArray(candidate) ? candidate[0] : candidate;
    const normalized = normalizeCountryCode(raw ?? null);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function resolveDefaultLocaleForMarket(market: SitePageMarket): SitePageLocale {
  return market === "rf" ? "ru" : "en";
}

function toSitePageState(row: SitePageRow): SitePageState {
  return {
    slug: row.slug as SitePageSlug,
    market: row.market as SitePageMarket,
    locale: row.locale as SitePageLocale,
    status: row.status as "draft" | "published",
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    version: row.version,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toPublicSitePageState(
  row: SitePageRow,
  availableVariants: SitePageVariantState[]
): PublicSitePageState {
  return {
    slug: row.slug as SitePageSlug,
    market: row.market as SitePageMarket,
    locale: row.locale as SitePageLocale,
    status: "published",
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    version: row.version,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    availableVariants
  };
}

@Injectable()
export class ManageSitePagesService {
  private readonly logger = new Logger(ManageSitePagesService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService
  ) {}

  parseSlug(value: string): SitePageSlug {
    if (!isSitePageSlug(value)) {
      throw new NotFoundException(`Unsupported site page slug "${value}".`);
    }
    return value;
  }

  parseSaveDraftInput(payload: unknown): SaveDraftInput {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Site page draft payload must be an object.");
    }
    const body = payload as Record<string, unknown>;
    const market = body.market;
    const locale = body.locale;
    if (typeof market !== "string" || !isSitePageMarket(market)) {
      throw new BadRequestException("market must be one of: rf, intl.");
    }
    if (typeof locale !== "string" || !isSitePageLocale(locale)) {
      throw new BadRequestException("locale must be one of: ru, en.");
    }
    return {
      market,
      locale,
      title: parseRequiredString(body.title, "title"),
      bodyMarkdown: parseRequiredString(body.bodyMarkdown, "bodyMarkdown"),
      version: parseNullableVersion(body.version)
    };
  }

  parsePublishInput(payload: unknown): PublishInput {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Site page publish payload must be an object.");
    }
    const body = payload as Record<string, unknown>;
    if (typeof body.market !== "string" || !isSitePageMarket(body.market)) {
      throw new BadRequestException("market must be one of: rf, intl.");
    }
    if (typeof body.locale !== "string" || !isSitePageLocale(body.locale)) {
      throw new BadRequestException("locale must be one of: ru, en.");
    }
    return {
      market: body.market,
      locale: body.locale
    };
  }

  resolveSuggestedCountryCode(
    headers: Record<string, string | string[] | undefined>
  ): string | null {
    const cookieCountry = normalizeCountryCode(parseCookieValue(headers.cookie, "persai-country"));
    return cookieCountry ?? inferCountryCodeFromHeaders(headers);
  }

  private resolveRequestedLocale(
    value: string | undefined,
    headers: Record<string, string | string[] | undefined>,
    market: SitePageMarket
  ): SitePageLocale {
    if (typeof value === "string") {
      if (isSitePageLocale(value)) {
        return value;
      }
      throw new BadRequestException("locale must be one of: ru, en.");
    }
    const cookieLocale = normalizeLocaleInput(parseCookieValue(headers.cookie, "persai-locale"));
    if (cookieLocale) {
      return cookieLocale;
    }
    const acceptLanguage = Array.isArray(headers["accept-language"])
      ? headers["accept-language"][0]
      : headers["accept-language"];
    const fromHeaders = normalizeLocaleInput(acceptLanguage);
    return fromHeaders ?? resolveDefaultLocaleForMarket(market);
  }

  private resolveRequestedMarket(
    value: string | undefined,
    headers: Record<string, string | string[] | undefined>
  ): SitePageMarket {
    if (typeof value === "string") {
      if (isSitePageMarket(value)) {
        return value;
      }
      throw new BadRequestException("market must be one of: rf, intl.");
    }
    const cookieCountry = normalizeCountryCode(parseCookieValue(headers.cookie, "persai-country"));
    return resolveLegalMarket(cookieCountry ?? inferCountryCodeFromHeaders(headers));
  }

  async getPublicPage(
    slug: SitePageSlug,
    query: { market: string | undefined; locale: string | undefined },
    headers: Record<string, string | string[] | undefined>
  ): Promise<{
    page: PublicSitePageState;
    resolvedMarket: SitePageMarket;
    resolvedLocale: SitePageLocale;
  }> {
    const resolvedMarket = this.resolveRequestedMarket(query.market, headers);
    const resolvedLocale = this.resolveRequestedLocale(query.locale, headers, resolvedMarket);
    const variants = await this.prisma.platformSitePage.findMany({
      where: {
        slug,
        status: "published"
      },
      select: {
        market: true,
        locale: true
      },
      orderBy: [{ market: "asc" }, { locale: "asc" }]
    });
    const availableVariants: SitePageVariantState[] = variants.map((variant) => ({
      market: variant.market as SitePageMarket,
      locale: variant.locale as SitePageLocale
    }));
    const page =
      (await this.prisma.platformSitePage.findUnique({
        where: {
          slug_market_locale_status: {
            slug,
            market: resolvedMarket,
            locale: resolvedLocale,
            status: "published"
          }
        }
      })) ??
      (await this.prisma.platformSitePage.findUnique({
        where: {
          slug_market_locale_status: {
            slug,
            market: resolvedMarket,
            locale: resolveDefaultLocaleForMarket(resolvedMarket),
            status: "published"
          }
        }
      }));
    if (!page) {
      throw new NotFoundException(`Published site page "${slug}" is not available.`);
    }
    return {
      page: toPublicSitePageState(page, availableVariants),
      resolvedMarket,
      resolvedLocale: (page.locale as SitePageLocale) ?? resolvedLocale
    };
  }

  async listAdminPages(userId: string): Promise<SitePageState[]> {
    await this.adminAuthorizationService.assertCanManagePlatformSitePages(userId);
    const pages = await this.prisma.platformSitePage.findMany({
      orderBy: [{ slug: "asc" }, { market: "asc" }, { locale: "asc" }, { status: "asc" }]
    });
    return pages.map((page) => toSitePageState(page));
  }

  async saveDraft(
    userId: string,
    slug: SitePageSlug,
    input: SaveDraftInput
  ): Promise<SitePageState> {
    await this.adminAuthorizationService.assertCanManagePlatformSitePages(userId);
    if ((slug === "terms" || slug === "privacy") && input.version === null) {
      throw new BadRequestException("terms and privacy drafts require a version.");
    }
    if ((slug === "requisites" || slug === "contacts") && input.version !== null) {
      throw new BadRequestException("requisites and contacts must not store a version.");
    }

    const page = await this.prisma.platformSitePage.upsert({
      where: {
        slug_market_locale_status: {
          slug,
          market: input.market,
          locale: input.locale,
          status: "draft"
        }
      },
      update: {
        title: input.title,
        bodyMarkdown: input.bodyMarkdown,
        version: input.version
      },
      create: {
        slug,
        market: input.market,
        locale: input.locale,
        status: "draft",
        title: input.title,
        bodyMarkdown: input.bodyMarkdown,
        version: input.version
      }
    });
    return toSitePageState(page);
  }

  async publish(userId: string, slug: SitePageSlug, input: PublishInput): Promise<SitePageState> {
    await this.adminAuthorizationService.assertCanManagePlatformSitePages(userId);

    const draft = await this.prisma.platformSitePage.findUnique({
      where: {
        slug_market_locale_status: {
          slug,
          market: input.market,
          locale: input.locale,
          status: "draft"
        }
      }
    });
    if (!draft) {
      throw new NotFoundException(
        `Draft for "${slug}" ${input.market}/${input.locale} was not found.`
      );
    }
    if ((slug === "terms" || slug === "privacy") && !draft.version) {
      throw new BadRequestException("terms and privacy require a version before publish.");
    }

    const publishedAt = new Date();
    const page = await this.prisma.platformSitePage.upsert({
      where: {
        slug_market_locale_status: {
          slug,
          market: input.market,
          locale: input.locale,
          status: "published"
        }
      },
      update: {
        title: draft.title,
        bodyMarkdown: draft.bodyMarkdown,
        version: slug === "requisites" || slug === "contacts" ? null : draft.version,
        publishedAt
      },
      create: {
        slug,
        market: input.market,
        locale: input.locale,
        status: "published",
        title: draft.title,
        bodyMarkdown: draft.bodyMarkdown,
        version: slug === "requisites" || slug === "contacts" ? null : draft.version,
        publishedAt
      }
    });

    this.logger.log(`Published site page ${slug} for ${input.market}/${input.locale}.`);
    return toSitePageState(page);
  }
}
