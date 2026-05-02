import assert from "node:assert/strict";
import { applyFinalDeliveryHonestyCorrection } from "../src/modules/workspace-management/application/final-delivery-honesty";

async function run(): Promise<void> {
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "x: [report.md](report.md)\n\nbody",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["report.md"],
      locale: null
    }),
    "body"
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa [report.md](sandbox:/tmp/report.md) bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["report.md"],
      locale: null
    }),
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa report.md bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Готово: [report.md](sandbox:/tmp/report.md)",
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "ru"
    }),
    "Готово: report.md\n\nПоправка: файл не был реально доставлен в этот чат в рамках этого ответа."
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Source: [report.md](https://example.com/report.md)",
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "en"
    }),
    "Source: [report.md](https://example.com/report.md)"
  );
}

void run();
