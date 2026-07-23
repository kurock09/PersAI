import { Inject, Injectable, Logger } from "@nestjs/common";
import { inflateRawSync } from "node:zlib";
import { loadApiConfig } from "@persai/config";
import type {
  ProviderGatewayMessageContentBlock,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { normalizeModelKey } from "./model-key-normalization";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import type { RuntimeProviderRoutingState } from "./runtime-provider-routing.types";
import { normalizeStoredAttachmentSemanticSummary } from "./media/media.types";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

const MICRO_DESCRIPTION_TIMEOUT_MS = 20_000;
const MICRO_DESCRIPTION_MAX_TEXT_CHARS = 4_000;
const MICRO_DESCRIPTION_MAX_BINARY_BYTES = 4 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/x-typescript",
  "application/yaml",
  "application/x-yaml",
  "application/x-httpd-php"
]);
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "html",
  "htm",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "sql",
  "py",
  "rb",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "sh",
  "ps1"
]);
const MICRO_DESCRIPTION_OUTPUT_SCHEMA = {
  name: "upload_micro_description",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: {
        type: "string"
      }
    }
  }
} as const;

type FileDescriptionRoute = {
  provider: "openai" | "anthropic" | "deepseek" | "kimi";
  model: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRuntimeProviderRouting(runtimeBundle: unknown): RuntimeProviderRoutingState | null {
  const root = asObject(runtimeBundle);
  const runtime = asObject(root?.runtime);
  const routing = asObject(runtime?.runtimeProviderRouting);
  if (routing?.schema !== "persai.runtimeProviderRouting.v1") {
    return null;
  }
  return routing as unknown as RuntimeProviderRoutingState;
}

function getFileExtension(filename: string | null): string | null {
  if (filename === null) {
    return null;
  }
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : null;
}

function isLikelyTextFile(params: { mimeType: string; filename: string | null }): boolean {
  if (params.mimeType.startsWith("text/")) {
    return true;
  }
  if (SUPPORTED_TEXT_MIME_TYPES.has(params.mimeType.toLowerCase())) {
    return true;
  }
  const extension = getFileExtension(params.filename);
  return extension !== null && SUPPORTED_TEXT_EXTENSIONS.has(extension);
}

function stripNullChars(value: string): string {
  return value.replaceAll("\0", "");
}

function countAsciiPrintableChars(value: string): number {
  let count = 0;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      count += 1;
    }
  }
  return count;
}

export function toUtf8Preview(buffer: Buffer): string | null {
  const preview = buffer.toString(
    "utf8",
    0,
    Math.min(buffer.length, MICRO_DESCRIPTION_MAX_TEXT_CHARS * 4)
  );
  const normalized = stripNullChars(preview)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MICRO_DESCRIPTION_MAX_TEXT_CHARS);
  if (normalized.length === 0) {
    return null;
  }
  const printableChars = countAsciiPrintableChars(normalized);
  return printableChars >= Math.max(24, Math.floor(normalized.length * 0.4)) ? normalized : null;
}

export function extractXlsxSharedStringsPreview(buffer: Buffer): string | null {
  const entries = readZipEntries(buffer);
  const sharedStrings = entries.get("xl/sharedStrings.xml");
  if (sharedStrings === undefined) {
    return null;
  }
  const xml = sharedStrings.toString("utf8");
  const parts = [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((match) => match[1] ?? "");
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length === 0) {
    return null;
  }
  return joined.slice(0, MICRO_DESCRIPTION_MAX_TEXT_CHARS);
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      break;
    }
    const name = buffer.toString("utf8", nameStart, nameEnd);
    const compressed = buffer.subarray(dataStart, dataEnd);
    let payload: Buffer;
    if (compression === 0) {
      payload = compressed;
    } else if (compression === 8) {
      payload = inflateRawSync(compressed);
    } else {
      offset = dataEnd;
      continue;
    }
    entries.set(name, payload);
    offset = dataEnd;
  }
  return entries;
}

@Injectable()
export class WorkspaceFileMicroDescriptionService {
  private readonly logger = new Logger(WorkspaceFileMicroDescriptionService.name);

  constructor(
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService
  ) {}

  async describeWorkspaceFile(input: {
    assistantId: string;
    workspaceId: string;
    path: string;
  }): Promise<{
    summary: string | null;
    usage: RuntimeUsageSnapshot | null;
    respondedAt: string;
    provider: "openai" | "anthropic" | "deepseek" | "kimi";
    model: string;
  } | null> {
    const metadata = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: input.path
    });
    if (metadata === null) {
      return null;
    }
    const downloaded = await this.downloadWorkspaceFile({
      workspaceId: input.workspaceId,
      path: input.path
    });
    if (downloaded === null) {
      return null;
    }
    const route = await this.resolveSystemToolRoute(input.assistantId);
    if (route === null) {
      return null;
    }
    const filename = input.path.split("/").pop() ?? null;
    const userContent = this.buildUserContent({
      mimeType: metadata.mimeType,
      filename,
      sizeBytes: Number(metadata.sizeBytes),
      buffer: downloaded
    });
    if (userContent === null) {
      return null;
    }
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_PROVIDER_GATEWAY_BASE_URL?.trim();
    if (!baseUrl) {
      return null;
    }
    const request: ProviderGatewayTextGenerateRequest = {
      provider: route.provider,
      model: route.model,
      systemPrompt:
        "You are a hidden upload analysis helper. Describe one uploaded file in a single short sentence. Mention the kind of file and its likely topic or subject. Do not quote long content, do not extract page details, and return an empty summary when the file is unsupported or unclear.",
      messages: [
        {
          role: "user",
          content: userContent
        }
      ],
      maxOutputTokens: 60,
      outputSchema: MICRO_DESCRIPTION_OUTPUT_SCHEMA,
      requestMetadata: {
        classification: "turn_routing",
        runtimeRequestId: null,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      }
    };
    try {
      const response = await this.postJson(
        new URL("/api/v1/providers/generate-text", baseUrl).toString(),
        request,
        MICRO_DESCRIPTION_TIMEOUT_MS
      );
      const payload = response.text ? (JSON.parse(response.text) as { summary?: unknown }) : {};
      const summary = normalizeStoredAttachmentSemanticSummary(
        typeof payload.summary === "string" ? payload.summary : null
      );
      return {
        summary,
        usage: response.usage,
        respondedAt: response.respondedAt,
        provider: response.provider,
        model: response.model
      };
    } catch (error) {
      this.logger.warn(
        `workspace_file_micro_description_failed path=${input.path}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  private async downloadWorkspaceFile(input: {
    workspaceId: string;
    path: string;
  }): Promise<Buffer | null> {
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: input.path
    });
    const downloaded = await this.mediaObjectStorage.downloadObject(objectKey);
    return downloaded?.buffer ?? null;
  }

  private async resolveSystemToolRoute(assistantId: string): Promise<FileDescriptionRoute | null> {
    try {
      const assistant = await this.assistantRepository.findById(assistantId);
      if (assistant === null) {
        return null;
      }
      const latestPublishedVersion =
        await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistantId);
      if (latestPublishedVersion === null) {
        return null;
      }
      const materializedSpec =
        await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(
          assistant,
          latestPublishedVersion,
          { mode: "rollout_aware" }
        );
      if (materializedSpec === null) {
        return null;
      }
      const runtimeBundle =
        materializedSpec.runtimeBundle ??
        (materializedSpec.runtimeBundleDocument
          ? (JSON.parse(materializedSpec.runtimeBundleDocument) as unknown)
          : null);
      const routing = parseRuntimeProviderRouting(runtimeBundle);
      const provider = routing?.modelSlots.systemTool.providerKey;
      const model = routing?.modelSlots.systemTool.modelKey;
      if (
        (provider !== "openai" &&
          provider !== "anthropic" &&
          provider !== "deepseek" &&
          provider !== "kimi") ||
        typeof model !== "string" ||
        model.trim().length === 0
      ) {
        return null;
      }
      return {
        provider,
        model: normalizeModelKey(model)
      };
    } catch {
      return null;
    }
  }

  private buildUserContent(input: {
    mimeType: string;
    filename: string | null;
    sizeBytes: number;
    buffer: Buffer;
  }): ProviderGatewayMessageContentBlock[] | string | null {
    const intro = [
      `Filename: ${input.filename ?? "uploaded-file"}`,
      `Mime type: ${input.mimeType}`,
      "Return JSON with a short `summary` string. Use an empty string if the file cannot be safely described."
    ].join("\n");
    if (isLikelyTextFile({ mimeType: input.mimeType, filename: input.filename })) {
      const preview = toUtf8Preview(input.buffer);
      if (preview === null) {
        return null;
      }
      return `${intro}\n\nText preview:\n${preview}`;
    }
    if (input.sizeBytes > MICRO_DESCRIPTION_MAX_BINARY_BYTES) {
      return null;
    }
    if (
      input.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      getFileExtension(input.filename) === "xlsx"
    ) {
      const preview = extractXlsxSharedStringsPreview(input.buffer);
      if (preview === null) {
        return null;
      }
      return `${intro}\n\nSpreadsheet text preview:\n${preview}`;
    }
    if (input.mimeType === "application/pdf") {
      return [
        { type: "text", text: intro },
        {
          type: "pdf",
          mimeType: "application/pdf",
          dataBase64: input.buffer.toString("base64"),
          filename: input.filename
        }
      ];
    }
    if (SUPPORTED_IMAGE_MIME_TYPES.has(input.mimeType)) {
      return [
        { type: "text", text: intro },
        {
          type: "image",
          mimeType: input.mimeType,
          dataBase64: input.buffer.toString("base64"),
          filename: input.filename
        }
      ];
    }
    return null;
  }

  private async postJson(
    url: string,
    body: ProviderGatewayTextGenerateRequest,
    timeoutMs: number
  ): Promise<ProviderGatewayTextGenerateResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
          bodyText.trim().length > 0
            ? `HTTP ${response.status}: ${bodyText.trim()}`
            : `HTTP ${response.status}`
        );
      }
      return (await response.json()) as ProviderGatewayTextGenerateResult;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
