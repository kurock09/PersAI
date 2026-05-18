import { Injectable } from "@nestjs/common";
import { resolveLegalMarket } from "@persai/types";
import { PrismaService } from "../infrastructure/persistence/prisma.service";
import { resolveMarketComplianceVersions } from "./compliance-baseline";

function defaultLocaleForMarket(market: "rf" | "intl"): "ru" | "en" {
  return market === "rf" ? "ru" : "en";
}

@Injectable()
export class ResolveComplianceBaselineService {
  constructor(private readonly prismaService: PrismaService) {}

  async resolve(countryCode: string | null | undefined): Promise<{
    market: "rf" | "intl";
    termsOfServiceVersion: string;
    privacyPolicyVersion: string;
  }> {
    const market = resolveLegalMarket(countryCode);
    const locale = defaultLocaleForMarket(market);
    const fallback = resolveMarketComplianceVersions(market);
    const pages = await this.prismaService.platformSitePage.findMany({
      where: {
        market,
        status: "published",
        slug: { in: ["terms", "privacy"] }
      },
      orderBy: [{ locale: "asc" }, { updatedAt: "desc" }]
    });
    const termsPage =
      pages.find((page) => page.slug === "terms" && page.locale === locale) ??
      pages.find((page) => page.slug === "terms");
    const privacyPage =
      pages.find((page) => page.slug === "privacy" && page.locale === locale) ??
      pages.find((page) => page.slug === "privacy");
    return {
      market,
      termsOfServiceVersion: termsPage?.version ?? fallback.termsOfServiceVersion,
      privacyPolicyVersion: privacyPage?.version ?? fallback.privacyPolicyVersion
    };
  }
}
