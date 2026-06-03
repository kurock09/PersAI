import { describe, expect, it } from "vitest";
import { formatPackageLabel } from "./page";

describe("packages page — formatPackageLabel (ADR-108 Slice 6b)", () => {
  it("renders N VC for video_generate packages (en)", () => {
    expect(
      formatPackageLabel("en", {
        id: "pkg-1",
        toolCode: "video_generate",
        units: 1000,
        amountMinor: 99900,
        amountMajor: 999,
        currency: "RUB",
        displayOrder: 1,
        highlighted: false,
        title: { ru: null, en: null },
        subtitle: { ru: null, en: null },
        ctaLabel: { ru: null, en: null },
        priceLabel: { ru: null, en: null }
      })
    ).toBe("1000 VC");
  });

  it("renders N VC for video_generate packages (ru locale)", () => {
    expect(
      formatPackageLabel("ru", {
        id: "pkg-2",
        toolCode: "video_generate",
        units: 500,
        amountMinor: 49900,
        amountMajor: 499,
        currency: "RUB",
        displayOrder: 1,
        highlighted: false,
        title: { ru: null, en: null },
        subtitle: { ru: null, en: null },
        ctaLabel: { ru: null, en: null },
        priceLabel: { ru: null, en: null }
      })
    ).toBe("500 VC");
  });

  it("renders N units for image_generate packages (en)", () => {
    expect(
      formatPackageLabel("en", {
        id: "pkg-3",
        toolCode: "image_generate",
        units: 10,
        amountMinor: 19900,
        amountMajor: 199,
        currency: "RUB",
        displayOrder: 1,
        highlighted: false,
        title: { ru: null, en: null },
        subtitle: { ru: null, en: null },
        ctaLabel: { ru: null, en: null },
        priceLabel: { ru: null, en: null }
      })
    ).toBe("10 units");
  });

  it("renders N единиц for image_generate packages (ru)", () => {
    expect(
      formatPackageLabel("ru", {
        id: "pkg-4",
        toolCode: "image_generate",
        units: 10,
        amountMinor: 19900,
        amountMajor: 199,
        currency: "RUB",
        displayOrder: 1,
        highlighted: false,
        title: { ru: null, en: null },
        subtitle: { ru: null, en: null },
        ctaLabel: { ru: null, en: null },
        priceLabel: { ru: null, en: null }
      })
    ).toBe("10 единиц");
  });

  it("prefers explicit title over computed VC label for video_generate", () => {
    expect(
      formatPackageLabel("en", {
        id: "pkg-5",
        toolCode: "video_generate",
        units: 1000,
        amountMinor: 99900,
        amountMajor: 999,
        currency: "RUB",
        displayOrder: 1,
        highlighted: false,
        title: { ru: null, en: "Starter video pack" },
        subtitle: { ru: null, en: null },
        ctaLabel: { ru: null, en: null },
        priceLabel: { ru: null, en: null }
      })
    ).toBe("Starter video pack");
  });
});
