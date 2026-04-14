import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeKnowledgeAccessSourceConfig,
  RuntimeKnowledgeFetchToolResult,
  RuntimeKnowledgeSearchToolResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

export interface RuntimeKnowledgeSearchExecutionResult {
  payload: RuntimeKnowledgeSearchToolResult;
  isError: boolean;
}

export interface RuntimeKnowledgeFetchExecutionResult {
  payload: RuntimeKnowledgeFetchToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeKnowledgeToolService {
  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeSearchToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    allowedSources: RuntimeKnowledgeAccessSourceConfig[];
  }): Promise<RuntimeKnowledgeSearchExecutionResult> {
    const request = this.readSearchArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.searchToolCode,
          source: "internal",
          executionMode: "inline",
          hits: [],
          action: "skipped",
          reason: "invalid_arguments"
        },
        isError: true
      };
    }

    if (!this.isSourceAllowed(params.allowedSources, request.source)) {
      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.searchToolCode,
          source: request.source,
          executionMode: "inline",
          hits: [],
          action: "skipped",
          reason: "source_unavailable"
        },
        isError: false
      };
    }

    try {
      const hits = await this.persaiInternalApiClientService.searchKnowledge({
        assistantId: params.bundle.metadata.assistantId,
        source: request.source,
        query: request.query,
        maxResults: request.maxResults
      });
      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.searchToolCode,
          source: request.source,
          executionMode: "inline",
          hits,
          action: "results",
          reason: null
        },
        isError: false
      };
    } catch {
      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.searchToolCode,
          source: request.source,
          executionMode: "inline",
          hits: [],
          action: "skipped",
          reason: "knowledge_search_failed"
        },
        isError: true
      };
    }
  }

  async executeFetchToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    allowedSources: RuntimeKnowledgeAccessSourceConfig[];
  }): Promise<RuntimeKnowledgeFetchExecutionResult> {
    const request = this.readFetchArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.fetchToolCode,
          source: "internal",
          executionMode: "inline",
          document: null,
          action: "skipped",
          reason: "invalid_arguments"
        },
        isError: true
      };
    }

    if (!this.isSourceAllowed(params.allowedSources, request.source)) {
      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.fetchToolCode,
          source: request.source,
          executionMode: "inline",
          document: null,
          action: "skipped",
          reason: "source_unavailable"
        },
        isError: false
      };
    }

    try {
      const document = await this.persaiInternalApiClientService.fetchKnowledge({
        assistantId: params.bundle.metadata.assistantId,
        source: request.source,
        referenceId: request.referenceId
      });
      if (document === null) {
        return {
          payload: {
            toolCode: params.bundle.runtime.knowledgeAccess.fetchToolCode,
            source: request.source,
            executionMode: "inline",
            document: null,
            action: "skipped",
            reason: "reference_not_found"
          },
          isError: false
        };
      }

      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.fetchToolCode,
          source: request.source,
          executionMode: "inline",
          document,
          action: "fetched",
          reason: null
        },
        isError: false
      };
    } catch {
      return {
        payload: {
          toolCode: params.bundle.runtime.knowledgeAccess.fetchToolCode,
          source: request.source,
          executionMode: "inline",
          document: null,
          action: "skipped",
          reason: "knowledge_fetch_failed"
        },
        isError: true
      };
    }
  }

  private readSearchArguments(args: Record<string, unknown>):
    | {
        source: RuntimeKnowledgeSearchToolResult["source"];
        query: string;
        maxResults: number | null;
      }
    | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) => key !== "source" && key !== "query" && key !== "maxResults"
    );
    const source = this.asNonEmptyString(args.source);
    const query = this.asNonEmptyString(args.query);
    const maxResults =
      args.maxResults === undefined || args.maxResults === null
        ? null
        : Number.isInteger(args.maxResults) && Number(args.maxResults) > 0
          ? Number(args.maxResults)
          : null;
    if (
      unknownKeys.length > 0 ||
      source === null ||
      query === null ||
      ("maxResults" in args && args.maxResults !== null && maxResults === null)
    ) {
      return new Error("Knowledge search arguments are invalid.");
    }

    return {
      source: source as RuntimeKnowledgeSearchToolResult["source"],
      query,
      maxResults
    };
  }

  private readFetchArguments(
    args: Record<string, unknown>
  ): { source: RuntimeKnowledgeFetchToolResult["source"]; referenceId: string } | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) => key !== "source" && key !== "referenceId"
    );
    const source = this.asNonEmptyString(args.source);
    const referenceId = this.asNonEmptyString(args.referenceId);
    if (unknownKeys.length > 0 || source === null || referenceId === null) {
      return new Error("Knowledge fetch arguments are invalid.");
    }

    return {
      source: source as RuntimeKnowledgeFetchToolResult["source"],
      referenceId
    };
  }

  private isSourceAllowed(
    allowedSources: RuntimeKnowledgeAccessSourceConfig[],
    source: string
  ): boolean {
    return allowedSources.some((allowedSource) => allowedSource.source === source);
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
