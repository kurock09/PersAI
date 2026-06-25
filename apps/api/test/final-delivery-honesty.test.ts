import assert from "node:assert/strict";
import {
  applyFinalDeliveryHonestyCorrection,
  buildExternalMediaDownloadLines
} from "../src/modules/workspace-management/application/final-delivery-honesty";

async function run(): Promise<void> {
  // Delivered-attachment link on a standalone line is stripped entirely; remaining body returned
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

  // Delivered-attachment link embedded in a long line: link text kept, href removed
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

  // Image attachment ref on standalone line stripped; surrounding prose kept
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

  // Undelivered phantom local-file link: href stripped, link text kept; NO correction appended
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Готово: [report.md](sandbox:/tmp/report.md)",
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "ru"
    }),
    "Готово: report.md"
  );

  // Safe https link left untouched
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

  // Technical attachment summary stripped; prose before it kept
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Вот он. Скинул в чат.\n\nAssistant sent an attachment: document "recommendations.md", storagePath: "/workspace/outbound/self/recommendations.md".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["recommendations.md"],
      locale: "ru"
    }),
    "Вот он. Скинул в чат."
  );

  // Technical attachment summary only + delivered → fallback
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Assistant sent an attachment: document "recommendations.md", storagePath: "/workspace/outbound/self/recommendations.md".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["recommendations.md"],
      locale: "ru"
    }),
    "Файл отправлен."
  );

  // Technical attachment summary only + nothing delivered → empty string (no correction)
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Вот этот. Отправила в чат:\n\nAssistant sent an attachment: document "recommendations.md", storagePath: "/workspace/outbound/self/recommendations.md".',
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "ru"
    }),
    "Вот этот. Отправила в чат:"
  );

  // Image attachment summary only + delivered → fallback
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: 'Assistant sent an attachment: image "mansion_photo_edit.png".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["mansion_photo_edit.png"],
      attemptedArtifactKind: "media",
      locale: "en"
    }),
    "Media sent."
  );

  // Multiple attachment summaries + one delivered → fallback
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText:
        'Assistant sent attachments: image "mansion_photo_edit.png", document "notes.txt".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["mansion_photo_edit.png"],
      attemptedArtifactKind: "media",
      locale: "en"
    }),
    "Media sent."
  );

  // Media-only fallback localizes for RU too.
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: 'Assistant sent an attachment: image "portrait.png".',
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["portrait.png"],
      attemptedArtifactKind: "media",
      locale: "ru"
    }),
    "Медиафайл отправлен."
  );

  // Working-files injection line stripped; prose kept
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

  // Bare prose media claim with NO link and NO attachment: left completely unchanged (structural-only)
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Готово, вот готовое фото.",
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "ru"
    }),
    "Готово, вот готовое фото."
  );

  // Bare prose file claim with NO link: left unchanged (no meaning-based detection)
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Your image is ready.",
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "en"
    }),
    "Your image is ready."
  );

  // Technical summary only, nothing delivered → empty string returned
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: 'Assistant sent an attachment: image "mansion_photo_edit.png".',
      attemptedArtifactCount: 0,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "en"
    }),
    ""
  );

  // Structural undelivered notice: a file was attempted but zero delivered → honest
  // notice appended (count-driven, not prose-detected); RU locale
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Готово, отправляю hello.txt",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "ru"
    }),
    "Готово, отправляю hello.txt\n\nПоправка: файл не был реально доставлен в этот чат."
  );

  // Same structural rule, EN locale, file kind (default)
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Here is your file.",
      attemptedArtifactCount: 2,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      locale: "en"
    }),
    "Here is your file.\n\nCorrection: no file was actually delivered in this reply."
  );

  // Structural rule with media kind → media-specific wording (EN)
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Your image is ready.",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 0,
      deliveredAttachmentFilenames: [],
      attemptedArtifactKind: "media",
      locale: "en"
    }),
    "Your image is ready.\n\nCorrection: no image or other media was actually delivered in this reply."
  );

  // Attempted > 0 but all delivered → no undelivered notice (full success)
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Here is your file.",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: ["hello.txt"],
      locale: "en"
    }),
    "Here is your file."
  );

  // External download-only delivery counts as delivered (no correction)
  assert.equal(
    applyFinalDeliveryHonestyCorrection({
      assistantText: "Your video is ready.",
      attemptedArtifactCount: 1,
      deliveredAttachmentCount: 1,
      deliveredAttachmentFilenames: [],
      attemptedArtifactKind: "media",
      locale: "ru"
    }),
    "Your video is ready."
  );

  assert.deepEqual(
    buildExternalMediaDownloadLines({
      items: [{ url: "https://files.heygen.ai/video/promo.mp4", filename: "promo.mp4" }],
      locale: "ru"
    }),
    [
      "Файл слишком большой для отправки прямо в чат. Скачать: [promo.mp4](https://files.heygen.ai/video/promo.mp4)"
    ]
  );
}

void run();
