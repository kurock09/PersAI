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
}

void run();
