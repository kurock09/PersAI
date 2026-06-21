import assert from "node:assert/strict";
import type {
  ProviderGatewayMessageContentBlock,
  ProviderGatewayTextMessage
} from "@persai/runtime-contract";
import {
  providerAcceptsMultimodalInput,
  sanitizeMultimodalContentBlocks,
  sanitizeMultimodalMessages,
  type DescribableContentBlock
} from "../src/modules/turns/runtime-text-only-multimodal-sanitizer";

/**
 * ADR-124 — the text-only multimodal sanitizer turns inline image/PDF blocks
 * into text for providers (DeepSeek) whose chat API cannot accept pixels, while
 * leaving vision-capable providers (OpenAI/Anthropic) untouched. These tests
 * pin: the provider gate, block→text replacement, the explicit placeholder on
 * a null/failed describe (never a silent drop or raw pixels), and idempotency
 * so re-running across tool-loop iterations triggers no redundant describe.
 */
export async function runRuntimeTextOnlyMultimodalSanitizerTest(): Promise<void> {
  assert.equal(providerAcceptsMultimodalInput("openai"), true);
  assert.equal(providerAcceptsMultimodalInput("anthropic"), true);
  assert.equal(providerAcceptsMultimodalInput("deepseek"), false);

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
}
