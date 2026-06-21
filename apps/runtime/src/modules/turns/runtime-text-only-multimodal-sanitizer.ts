import type {
  ProviderGatewayImageContentBlock,
  ProviderGatewayMessageContent,
  ProviderGatewayMessageContentBlock,
  ProviderGatewayPdfContentBlock,
  ProviderGatewayTextMessage
} from "@persai/runtime-contract";

/**
 * ADR-124 — providers whose chat input natively accepts inline image/PDF
 * (multimodal) content blocks. DeepSeek's `/chat/completions` API is text-only,
 * so any non-text block destined for a DeepSeek main turn must first be turned
 * into text. OpenAI/Anthropic accept the blocks directly and are left untouched.
 */
const MULTIMODAL_INPUT_PROVIDERS: ReadonlySet<string> = new Set(["openai", "anthropic"]);

export function providerAcceptsMultimodalInput(provider: string): boolean {
  return MULTIMODAL_INPUT_PROVIDERS.has(provider);
}

export type DescribableContentBlock =
  | ProviderGatewayImageContentBlock
  | ProviderGatewayPdfContentBlock;

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

/**
 * Replaces every non-text block in the array with a text description. Returns
 * the original array reference (changed=false) when it is already text-only, so
 * callers can cheaply re-run this without triggering redundant describe calls.
 */
export async function sanitizeMultimodalContentBlocks(
  blocks: ProviderGatewayMessageContentBlock[],
  describe: MultimodalBlockDescriber
): Promise<{ blocks: ProviderGatewayMessageContentBlock[]; changed: boolean }> {
  if (!blocks.some((block) => block.type !== "text")) {
    return { blocks, changed: false };
  }
  const next: ProviderGatewayMessageContentBlock[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      next.push(block);
      continue;
    }
    next.push(await describeBlockToTextBlock(block, describe));
  }
  return { blocks: next, changed: true };
}

async function sanitizeMultimodalContent(
  content: ProviderGatewayMessageContent,
  describe: MultimodalBlockDescriber
): Promise<{ content: ProviderGatewayMessageContent; changed: boolean }> {
  if (typeof content === "string") {
    return { content, changed: false };
  }
  const { blocks, changed } = await sanitizeMultimodalContentBlocks(content, describe);
  return { content: blocks, changed };
}

/**
 * Returns a message array whose content carries no inline image/PDF blocks.
 * Returns the original reference when nothing changed (already text-only), so
 * re-running on the same request across tool-loop iterations is a cheap no-op.
 */
export async function sanitizeMultimodalMessages(
  messages: ProviderGatewayTextMessage[],
  describe: MultimodalBlockDescriber
): Promise<ProviderGatewayTextMessage[]> {
  let anyChanged = false;
  const next: ProviderGatewayTextMessage[] = [];
  for (const message of messages) {
    const { content, changed } = await sanitizeMultimodalContent(message.content, describe);
    if (changed) {
      anyChanged = true;
      next.push({ ...message, content });
    } else {
      next.push(message);
    }
  }
  return anyChanged ? next : messages;
}
