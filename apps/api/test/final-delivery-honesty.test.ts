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
      assistantText:
        "Вот.\n\n![board_concept_diagram](attachment://91f42692-f101-498a-b7f1-d9d37869c581)\n\n### Дальше\n- Сделать вторую версию",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["board_concept_diagram.png"],
      locale: "ru"
    }),
    "Вот.\n\n### Дальше\n- Сделать вторую версию"
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

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Вот он. Скинул в чат.\n\nAssistant sent an attachment: document "recommendations.md", fileRef: "file-ref-1".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["recommendations.md"],
      locale: "ru"
    }),
    "Вот он. Скинул в чат."
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Assistant sent an attachment: document "recommendations.md", fileRef: "file-ref-1".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["recommendations.md"],
      locale: "ru"
    }),
    "Файл отправлен."
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Вот этот. Отправила в чат:\n\nAssistant sent an attachment: document "recommendations.md", fileRef: "file-ref-1".',
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "ru"
    }),
    "Вот этот. Отправила в чат:\n\nПоправка: файл не был реально доставлен в этот чат в рамках этого ответа."
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: 'Assistant sent an attachment: image "mansion_photo_edit.png".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["mansion_photo_edit.png"],
      locale: "en"
    }),
    "File sent."
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Assistant sent attachments: image "mansion_photo_edit.png", document "notes.txt".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["mansion_photo_edit.png"],
      locale: "en"
    }),
    "File sent."
  );

  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        "Here you go.\n\n[Working files from user attachments: previous attachment #1 = report.txt; previous image #1 = forest.png]",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["report.txt"],
      locale: "en"
    }),
    "Here you go."
  );
}

void run();
