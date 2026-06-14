import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCurrentMessageAttachmentLabel,
  shouldLabelCurrentMessageAttachments
} from "../src/modules/turns/current-message-attachment-labels";

test("shouldLabelCurrentMessageAttachments is true only for multi-attach", () => {
  assert.equal(shouldLabelCurrentMessageAttachments(0), false);
  assert.equal(shouldLabelCurrentMessageAttachments(1), false);
  assert.equal(shouldLabelCurrentMessageAttachments(2), true);
});

test("formatCurrentMessageAttachmentLabel distinguishes current message index from Working Files aliases", () => {
  const label = formatCurrentMessageAttachmentLabel(2, 3);
  assert.match(label, /Current message attachment 2 of 3/i);
  assert.match(label, /Working Files sticky aliases/i);
  assert.doesNotMatch(label, /image #2/i);
});
