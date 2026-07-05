import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { PersaiAdminMcpConfig } from "./config.js";

export class PersaiOperatorApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "PersaiOperatorApiError";
  }
}

export class PersaiOperatorClient {
  constructor(private readonly config: PersaiAdminMcpConfig) {}

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.operatorToken}`,
      ...(extra ?? {})
    };
  }

  private async parseJson(response: Response): Promise<unknown> {
    return response.json().catch(() => null);
  }

  async requestJson(params: {
    method: string;
    path: string;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      params.timeoutMs ?? this.config.fetchTimeoutMs
    );
    try {
      const init: RequestInit = {
        method: params.method,
        headers: this.authHeaders(
          params.body === undefined ? undefined : { "Content-Type": "application/json" }
        ),
        signal: controller.signal
      };
      if (params.body !== undefined) {
        init.body = JSON.stringify(params.body);
      }
      const response = await fetch(`${this.config.apiBaseUrl}${params.path}`, init);
      const payload = await this.parseJson(response);
      if (!response.ok) {
        throw new PersaiOperatorApiError(
          `PersAI API ${params.method} ${params.path} failed with ${String(response.status)}`,
          response.status,
          payload
        );
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestBinary(params: {
    path: string;
    timeoutMs?: number;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      params.timeoutMs ?? this.config.fetchTimeoutMs
    );
    try {
      const response = await fetch(`${this.config.apiBaseUrl}${params.path}`, {
        method: "GET",
        headers: this.authHeaders(),
        signal: controller.signal
      });
      if (!response.ok) {
        const payload = await this.parseJson(response);
        throw new PersaiOperatorApiError(
          `PersAI API GET ${params.path} failed with ${String(response.status)}`,
          response.status,
          payload
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      return { buffer: Buffer.from(arrayBuffer), contentType };
    } finally {
      clearTimeout(timeout);
    }
  }

  async uploadSkillDocument(params: {
    skillId: string;
    filePath: string;
    displayName?: string | null;
    description?: string | null;
  }): Promise<unknown> {
    const buffer = await readFile(params.filePath);
    const filename = basename(params.filePath);
    const form = new FormData();
    form.append("file", new Blob([buffer]), filename);
    if (params.displayName !== undefined && params.displayName !== null) {
      form.append("displayName", params.displayName);
    }
    if (params.description !== undefined && params.description !== null) {
      form.append("description", params.description);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
    try {
      const response = await fetch(
        `${this.config.apiBaseUrl}/api/v1/admin/skills/${params.skillId}/documents`,
        {
          method: "POST",
          headers: this.authHeaders(),
          body: form,
          signal: controller.signal
        }
      );
      const payload = await this.parseJson(response);
      if (!response.ok) {
        throw new PersaiOperatorApiError(
          `PersAI document upload failed with ${String(response.status)}`,
          response.status,
          payload
        );
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async uploadChatStageAttachment(params: {
    surfaceThreadKey: string;
    clientTurnId: string;
    filePath: string;
    clientAttachmentId?: string | null;
  }): Promise<unknown> {
    const buffer = await readFile(params.filePath);
    const filename = basename(params.filePath);
    const form = new FormData();
    form.append("file", new Blob([buffer]), filename);
    form.append("surfaceThreadKey", params.surfaceThreadKey);
    form.append("clientTurnId", params.clientTurnId);
    if (params.clientAttachmentId) {
      form.append("clientAttachmentId", params.clientAttachmentId);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.chatTimeoutMs);
    try {
      const response = await fetch(
        `${this.config.apiBaseUrl}/api/v1/assistant/chat/web/stage-attachment`,
        {
          method: "POST",
          headers: this.authHeaders(),
          body: form,
          signal: controller.signal
        }
      );
      const payload = await this.parseJson(response);
      if (!response.ok) {
        throw new PersaiOperatorApiError(
          `PersAI chat stage-attachment failed with ${String(response.status)}`,
          response.status,
          payload
        );
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}
