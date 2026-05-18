import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { ManageSitePagesService } from "../src/modules/workspace-management/application/manage-site-pages.service";
import { ResolveComplianceBaselineService } from "../src/modules/identity-access/application/resolve-compliance-baseline.service";

async function run(): Promise<void> {
  {
    const service = new ManageSitePagesService(
      {
        platformSitePage: {
          findMany: async () => [
            { market: "intl", locale: "en" },
            { market: "rf", locale: "ru" }
          ],
          findUnique: async () => ({
            slug: "terms",
            market: "rf",
            locale: "ru",
            status: "published",
            title: "Terms",
            bodyMarkdown: "Body",
            version: "rf:persai_tos_mvp_v1",
            publishedAt: new Date("2026-05-18T00:00:00.000Z"),
            createdAt: new Date("2026-05-18T00:00:00.000Z"),
            updatedAt: new Date("2026-05-18T00:00:00.000Z")
          })
        }
      } as never,
      {
        assertCanManagePlatformSitePages: async () => ({})
      } as never
    );

    const result = await service.getPublicPage(
      "terms",
      { market: "rf", locale: "ru" },
      { cookie: undefined, "accept-language": undefined }
    );
    assert.deepEqual(result.page.availableVariants, [
      { market: "intl", locale: "en" },
      { market: "rf", locale: "ru" }
    ]);
    assert.equal(result.resolvedMarket, "rf");
    assert.equal(result.resolvedLocale, "ru");
  }

  {
    const service = new ManageSitePagesService(
      {
        platformSitePage: {
          findMany: async () => [{ market: "rf", locale: "ru" }],
          findUnique: async () => ({
            slug: "privacy",
            market: "rf",
            locale: "ru",
            status: "published",
            title: "Privacy",
            bodyMarkdown: "Body",
            version: "rf:persai_privacy_mvp_v1",
            publishedAt: new Date("2026-05-18T00:00:00.000Z"),
            createdAt: new Date("2026-05-18T00:00:00.000Z"),
            updatedAt: new Date("2026-05-18T00:00:00.000Z")
          })
        }
      } as never,
      {
        assertCanManagePlatformSitePages: async () => ({})
      } as never
    );

    const result = await service.getPublicPage(
      "privacy",
      { market: undefined, locale: undefined },
      { cookie: undefined, "accept-language": undefined }
    );
    assert.equal(result.resolvedMarket, "rf");
    assert.equal(result.resolvedLocale, "ru");
  }

  {
    const service = new ManageSitePagesService(
      {
        platformSitePage: {
          findMany: async () => [],
          findUnique: async () => null
        }
      } as never,
      {
        assertCanManagePlatformSitePages: async () => ({})
      } as never
    );

    await assert.rejects(
      () =>
        service.getPublicPage(
          "terms",
          { market: "RF", locale: "ru" },
          { cookie: undefined, "accept-language": undefined }
        ),
      BadRequestException
    );
    await assert.rejects(
      () =>
        service.getPublicPage(
          "terms",
          { market: "rf", locale: "en-US" },
          { cookie: undefined, "accept-language": undefined }
        ),
      BadRequestException
    );
  }

  {
    const compliance = new ResolveComplianceBaselineService({
      platformSitePage: {
        findMany: async () => []
      }
    } as never);

    const rf = await compliance.resolve("RU");
    assert.equal(rf.market, "rf");
    assert.equal(rf.termsOfServiceVersion, "rf:persai_tos_mvp_v1");
    assert.equal(rf.privacyPolicyVersion, "rf:persai_privacy_mvp_v1");

    const intl = await compliance.resolve("DE");
    assert.equal(intl.market, "intl");
    assert.equal(intl.termsOfServiceVersion, "intl:persai_tos_mvp_v1");
    assert.equal(intl.privacyPolicyVersion, "intl:persai_privacy_mvp_v1");
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
