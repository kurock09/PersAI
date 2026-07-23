import assert from "node:assert/strict";
import type {
  ProviderGatewayMessageContentBlock,
  ProviderGatewayTextMessage
} from "@persai/runtime-contract";
import {
  providerAcceptsMultimodalInput,
  providerAcceptsPdfInput,
  resolveMultimodalSanitizeStripMode,
  sanitizeMultimodalContentBlocks,
  sanitizeMultimodalMessages,
  type DescribableContentBlock
} from "../src/modules/turns/runtime-text-only-multimodal-sanitizer";

/**
 * ADR-124 / ADR-163 — multimodal sanitizer turns unsupported image/PDF blocks
 * into text. DeepSeek is fully text-only; Kimi keeps images and strips PDFs;
 * OpenAI/Anthropic accept both and are never sanitized here.
 */
export async function runRuntimeTextOnlyMultimodalSanitizerTest(): Promise<void> {
  assert.equal(providerAcceptsMultimodalInput("openai"), true);
  assert.equal(providerAcceptsMultimodalInput("anthropic"), true);
  assert.equal(providerAcceptsMultimodalInput("kimi"), true);
  assert.equal(providerAcceptsMultimodalInput("deepseek"), false);

  assert.equal(providerAcceptsPdfInput("openai"), true);
  assert.equal(providerAcceptsPdfInput("anthropic"), true);
  assert.equal(providerAcceptsPdfInput("kimi"), false);
  assert.equal(providerAcceptsPdfInput("deepseek"), false);

  assert.equal(resolveMultimodalSanitizeStripMode("openai"), null);
  assert.equal(resolveMultimodalSanitizeStripMode("anthropic"), null);
  assert.equal(resolveMultimodalSanitizeStripMode("kimi"), "pdf_only");
  assert.equal(resolveMultimodalSanitizeStripMode("deepseek"), "all_non_text");

  const imageBlock: ProviderGatewayMessageContentBlock = {
    type: "image",
    mimeType: "image/png",
    dataBase64: "AAAA",
    filename: "diagram.png"
  };
  const pdfBlock: ProviderGatewayMessageContentBlock = {
    type: "pdf",
    mimeType: "application/pdf",
    dataBase64: "BBBB",
    filename: "report.pdf"
  };

  let describeCalls = 0;
  const describe = async (block: DescribableContentBlock): Promise<string | null> => {
    describeCalls += 1;
    return block.type === "image" ? "a flowchart of the pipeline" : "a quarterly revenue table";
  };

  // ── Replacement: image/pdf blocks become text; intro text is preserved. ──
  const original: ProviderGatewayMessageContentBlock[] = [
    { type: "text", text: "File preview (diagram.png)" },
    imageBlock,
    pdfBlock
  ];
  const replaced = await sanitizeMultimodalContentBlocks(original, describe);
  assert.equal(replaced.changed, true);
  assert.equal(describeCalls, 2);
  assert.equal(replaced.blocks.length, 3);
  assert.equal(replaced.blocks[0]?.type, "text");
  assert.deepEqual(
    replaced.blocks.map((block) => block.type),
    ["text", "text", "text"]
  );
  const imageText = replaced.blocks[1];
  const pdfText = replaced.blocks[2];
  assert.ok(imageText?.type === "text" && /diagram\.png/.test(imageText.text));
  assert.ok(imageText.type === "text" && /flowchart of the pipeline/.test(imageText.text));
  assert.ok(pdfText?.type === "text" && /report\.pdf/.test(pdfText.text));
  // No raw pixel data must survive into the sanitized content.
  assert.equal(
    JSON.stringify(replaced.blocks).includes("dataBase64"),
    false,
    "sanitized content must not carry base64 pixel data"
  );

  // ── ADR-163 Kimi: keep images, describe-away PDF only. ──
  describeCalls = 0;
  const kimiMixed: ProviderGatewayMessageContentBlock[] = [
    { type: "text", text: "look" },
    imageBlock,
    pdfBlock
  ];
  const kimiSanitized = await sanitizeMultimodalContentBlocks(kimiMixed, describe, "pdf_only");
  assert.equal(kimiSanitized.changed, true);
  assert.equal(describeCalls, 1, "kimi pdf_only must describe only the PDF block");
  assert.deepEqual(
    kimiSanitized.blocks.map((block) => block.type),
    ["text", "image", "text"]
  );
  assert.equal(kimiSanitized.blocks[1], imageBlock, "kimi must keep the raw image block");
  const kimiPdfText = kimiSanitized.blocks[2];
  assert.ok(kimiPdfText?.type === "text" && /report\.pdf/.test(kimiPdfText.text));
  assert.ok(kimiPdfText.type === "text" && /quarterly revenue table/.test(kimiPdfText.text));
  assert.equal(
    JSON.stringify(kimiSanitized.blocks[2]).includes("dataBase64"),
    false,
    "kimi PDF sanitize must not leave PDF base64 in the replaced text block"
  );

  // Image-only content under pdf_only is a no-op (same reference).
  describeCalls = 0;
  const kimiImagesOnly: ProviderGatewayMessageContentBlock[] = [
    { type: "text", text: "photo" },
    imageBlock
  ];
  const kimiImagesResult = await sanitizeMultimodalContentBlocks(
    kimiImagesOnly,
    describe,
    "pdf_only"
  );
  assert.equal(kimiImagesResult.changed, false);
  assert.equal(kimiImagesResult.blocks, kimiImagesOnly);
  assert.equal(describeCalls, 0);

  // ── Idempotency: text-only content returns the SAME reference, no describe. ──
  describeCalls = 0;
  const alreadyText: ProviderGatewayMessageContentBlock[] = [{ type: "text", text: "hi" }];
  const second = await sanitizeMultimodalContentBlocks(alreadyText, describe);
  assert.equal(second.changed, false);
  assert.equal(second.blocks, alreadyText);
  assert.equal(describeCalls, 0);

  // ── Null describe (no vision helper / failure) → explicit placeholder. ──
  const placeholderResult = await sanitizeMultimodalContentBlocks([imageBlock], async () => null);
  const placeholder = placeholderResult.blocks[0];
  assert.ok(placeholder?.type === "text" && /could not be analyzed/.test(placeholder.text));
  assert.ok(placeholder.type === "text" && /diagram\.png/.test(placeholder.text));

  // ── Thrown describe is caught and also yields the placeholder. ──
  const throwingResult = await sanitizeMultimodalContentBlocks([imageBlock], async () => {
    throw new Error("vision provider unavailable");
  });
  const throwingBlock = throwingResult.blocks[0];
  assert.ok(throwingBlock?.type === "text" && /could not be analyzed/.test(throwingBlock.text));

  // ── Messages: string content passes through; block content is sanitized. ──
  const messages: ProviderGatewayTextMessage[] = [
    { role: "assistant", content: "earlier reply" },
    { role: "user", content: [{ type: "text", text: "look" }, imageBlock] }
  ];
  describeCalls = 0;
  const sanitizedMessages = await sanitizeMultimodalMessages(messages, describe);
  assert.notEqual(sanitizedMessages, messages);
  assert.equal(sanitizedMessages[0], messages[0], "unchanged messages keep their reference");
  assert.equal(describeCalls, 1);
  const userContent = sanitizedMessages[1]?.content;
  assert.ok(Array.isArray(userContent));
  assert.deepEqual(
    (userContent as ProviderGatewayMessageContentBlock[]).map((block) => block.type),
    ["text", "text"]
  );

  // ── Idempotency on messages: re-running sanitized output is a no-op. ──
  describeCalls = 0;
  const reSanitized = await sanitizeMultimodalMessages(sanitizedMessages, describe);
  assert.equal(reSanitized, sanitizedMessages);
  assert.equal(describeCalls, 0);

  // ── Kimi messages: PDF stripped, image retained across the message array. ──
  describeCalls = 0;
  const kimiMessages: ProviderGatewayTextMessage[] = [
    { role: "user", content: [{ type: "text", text: "docs" }, imageBlock, pdfBlock] }
  ];
  const kimiMessageResult = await sanitizeMultimodalMessages(kimiMessages, describe, "pdf_only");
  assert.notEqual(kimiMessageResult, kimiMessages);
  assert.equal(describeCalls, 1);
  const kimiUserContent = kimiMessageResult[0]?.content;
  assert.ok(Array.isArray(kimiUserContent));
  assert.deepEqual(
    (kimiUserContent as ProviderGatewayMessageContentBlock[]).map((block) => block.type),
    ["text", "image", "text"]
  );
}
