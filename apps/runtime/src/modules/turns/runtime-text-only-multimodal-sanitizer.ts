import {
  providerAcceptsMultimodalInput as sharedProviderAcceptsMultimodalInput,
  providerAcceptsPdfInput as sharedProviderAcceptsPdfInput,
  type ProviderGatewayImageContentBlock,
  type ProviderGatewayMessageContent,
  type ProviderGatewayMessageContentBlock,
  type ProviderGatewayPdfContentBlock,
  type ProviderGatewayTextMessage
} from "@persai/runtime-contract";

/**
 * ADR-124 / ADR-163 — providers whose chat input natively accepts inline image
 * content blocks. Canonical allowlist is `PERSAI_MULTIMODAL_INPUT_CHAT_PROVIDERS`
 * in runtime-contract (openai/anthropic/kimi). DeepSeek remains text-only.
 */
export function providerAcceptsMultimodalInput(provider: string): boolean {
  return sharedProviderAcceptsMultimodalInput(provider);
}

/**
 * ADR-163 — providers whose chat input accepts PersAI inline PDF blocks.
 * Canonical allowlist is `PERSAI_PDF_INPUT_CHAT_PROVIDERS` (openai/anthropic).
 * Kimi accepts images but rejects PDF blocks.
 */
export function providerAcceptsPdfInput(provider: string): boolean {
  return sharedProviderAcceptsPdfInput(provider);
}

export type DescribableContentBlock =
  | ProviderGatewayImageContentBlock
  | ProviderGatewayPdfContentBlock;

export type MultimodalSanitizeStripMode = "all_non_text" | "pdf_only";

/**
 * Produces a concise text description of a non-text block, or null when no
 * description could be produced (no vision-capable helper configured, or the
 * describe call failed). Null yields an explicit placeholder rather than a
 * silent drop, so the model is always told an attachment was present.
 */
export type MultimodalBlockDescriber = (block: DescribableContentBlock) => Promise<string | null>;

function describableLabel(block: DescribableContentBlock): { kind: string; label: string } {
  const kind = block.type === "image" ? "Image" : "PDF document";
  return { kind, label: block.filename ?? "attachment" };
}

async function describeBlockToTextBlock(
  block: DescribableContentBlock,
  describe: MultimodalBlockDescriber
): Promise<ProviderGatewayMessageContentBlock> {
  const { kind, label } = describableLabel(block);
  let description: string | null = null;
  try {
    description = await describe(block);
  } catch {
    description = null;
  }
  const normalized = description?.trim() ?? "";
  const text =
    normalized.length > 0
      ? `[${kind} "${label}" (analyzed by vision helper): ${normalized}]`
      : `[${kind} "${label}" was attached but could not be analyzed for this model.]`;
  return { type: "text", text };
}

function shouldStripBlock(
  block: ProviderGatewayMessageContentBlock,
  stripMode: MultimodalSanitizeStripMode
): block is DescribableContentBlock {
  if (block.type === "text") {
    return false;
  }
  if (stripMode === "pdf_only") {
    return block.type === "pdf";
  }
  return true;
}

/**
 * Replaces stripped non-text blocks with text descriptions. Returns the
 * original array reference (changed=false) when nothing needs stripping, so
 * callers can cheaply re-run this without triggering redundant describe calls.
 *
 * - `all_non_text` (default): DeepSeek / text-only — strip image + PDF.
 * - `pdf_only`: Kimi — keep images, describe-away PDF blocks only.
 */
export async function sanitizeMultimodalContentBlocks(
  blocks: ProviderGatewayMessageContentBlock[],
  describe: MultimodalBlockDescriber,
  stripMode: MultimodalSanitizeStripMode = "all_non_text"
): Promise<{ blocks: ProviderGatewayMessageContentBlock[]; changed: boolean }> {
  if (!blocks.some((block) => shouldStripBlock(block, stripMode))) {
    return { blocks, changed: false };
  }
  const next: ProviderGatewayMessageContentBlock[] = [];
  for (const block of blocks) {
    if (!shouldStripBlock(block, stripMode)) {
      next.push(block);
      continue;
    }
    next.push(await describeBlockToTextBlock(block, describe));
  }
  return { blocks: next, changed: true };
}

async function sanitizeMultimodalContent(
  content: ProviderGatewayMessageContent,
  describe: MultimodalBlockDescriber,
  stripMode: MultimodalSanitizeStripMode
): Promise<{ content: ProviderGatewayMessageContent; changed: boolean }> {
  if (typeof content === "string") {
    return { content, changed: false };
  }
  const { blocks, changed } = await sanitizeMultimodalContentBlocks(content, describe, stripMode);
  return { content: blocks, changed };
}

/**
 * Returns a message array whose content has unsupported multimodal blocks
 * replaced with text. Returns the original reference when nothing changed.
 */
export async function sanitizeMultimodalMessages(
  messages: ProviderGatewayTextMessage[],
  describe: MultimodalBlockDescriber,
  stripMode: MultimodalSanitizeStripMode = "all_non_text"
): Promise<ProviderGatewayTextMessage[]> {
  let anyChanged = false;
  const next: ProviderGatewayTextMessage[] = [];
  for (const message of messages) {
    const { content, changed } = await sanitizeMultimodalContent(
      message.content,
      describe,
      stripMode
    );
    if (changed) {
      anyChanged = true;
      next.push({ ...message, content });
    } else {
      next.push(message);
    }
  }
  return anyChanged ? next : messages;
}

/**
 * Resolve which multimodal blocks must be stripped for a chat provider.
 * Returns null when the provider accepts both images and PersAI PDF blocks.
 */
export function resolveMultimodalSanitizeStripMode(
  provider: string
): MultimodalSanitizeStripMode | null {
  if (providerAcceptsMultimodalInput(provider) && providerAcceptsPdfInput(provider)) {
    return null;
  }
  if (providerAcceptsMultimodalInput(provider) && !providerAcceptsPdfInput(provider)) {
    return "pdf_only";
  }
  return "all_non_text";
}
