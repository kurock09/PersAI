import assert from "node:assert/strict";
import test from "node:test";
import { buildQuotaOfferState } from "../src/modules/workspace-management/application/quota-offers";

test("buildQuotaOfferState exposes amountMajor and priceLabel for media packages", () => {
  const state = buildQuotaOfferState({
    currentPlanCode: "pro",
    visiblePlans: [
      {
        code: "pro",
        displayName: "Pro",
        enabledToolCodes: ["document"],
        amountMinor: 199000,
        limits: {
          imageGenerateMonthlyUnitsLimit: null,
          imageEditMonthlyUnitsLimit: null,
          documentMonthlyUnitsLimit: 5
        },
        videoVcoinMonthlyGrant: 0
      }
    ],
    currentActiveToolCodes: new Set(["document"]),
    publicPackages: [
      {
        id: "pkg-document-1",
        packageType: "document",
        units: 5,
        amountMinor: 20000,
        currency: "RUB",
        isActive: true,
        displayOrder: 0,
        highlighted: true,
        title: { ru: "5 документов", en: "5 documents" },
        subtitle: { ru: "", en: "" },
        ctaLabel: { ru: "Купить", en: "Buy" },
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      }
    ]
  });

  const offer = state.tools.find((tool) => tool.toolCode === "document")?.offers[0];
  assert.equal(offer?.amountMinor, 20000);
  assert.equal(offer?.amountMajor, 200);
  assert.match(offer?.priceLabel.ru ?? "", /200/);
  assert.doesNotMatch(offer?.priceLabel.ru ?? "", /20\s?000/);
});
