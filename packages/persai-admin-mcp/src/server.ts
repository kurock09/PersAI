import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PersaiAdminMcpConfig } from "./config.js";
import { PersaiOperatorApiError, PersaiOperatorClient } from "./client.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toolText(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

function toolError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (error instanceof PersaiOperatorApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { message: error.message, status: error.status, body: error.body },
            null,
            2
          )
        }
      ]
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

function mapAttachment(attachment: unknown): Record<string, unknown> | null {
  const row = asRecord(attachment);
  if (row === null) {
    return null;
  }
  return {
    id: row.id ?? null,
    path: row.path ?? null,
    mimeType: row.mimeType ?? null,
    originalFilename: row.originalFilename ?? null,
    processingStatus: row.processingStatus ?? null,
    attachmentType: row.attachmentType ?? null,
    documentLink: row.documentLink ?? null
  };
}

function mapMessage(message: unknown): Record<string, unknown> | null {
  const row = asRecord(message);
  if (row === null) {
    return null;
  }
  const attachments = Array.isArray(row.attachments)
    ? row.attachments
        .map((item) => mapAttachment(item))
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
  return {
    id: row.id ?? null,
    content: row.content ?? "",
    attachments,
    toolInvocations: row.toolInvocations ?? [],
    workingNotes: row.workingNotes ?? []
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPersaiAdminMcpServer(
  config: PersaiAdminMcpConfig,
  client: PersaiOperatorClient = new PersaiOperatorClient(config)
): McpServer {
  const server = new McpServer({
    name: "persai-admin-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "skill_upsert",
    {
      description:
        "Create or update an admin Skill (core fields + instructionCard). Pass skillId to update.",
      inputSchema: z.object({
        skillId: z.string().uuid().optional(),
        body: z.record(z.unknown())
      })
    },
    async ({ skillId, body }) => {
      try {
        const payload =
          skillId === undefined
            ? await client.requestJson({ method: "POST", path: "/api/v1/admin/skills", body })
            : await client.requestJson({
                method: "PATCH",
                path: `/api/v1/admin/skills/${skillId}`,
                body
              });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_get",
    {
      description: "Fetch a Skill with documents, knowledge cards, and scenarios.",
      inputSchema: z.object({ skillId: z.string().uuid() })
    },
    async ({ skillId }) => {
      try {
        const [skill, scenarios] = await Promise.all([
          client.requestJson({ method: "GET", path: `/api/v1/admin/skills/${skillId}` }),
          client.requestJson({
            method: "GET",
            path: `/api/v1/admin/skills/${skillId}/scenarios`
          })
        ]);
        return toolText({ skill, scenarios });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_card_upsert",
    {
      description:
        "Create or update a Skill knowledge card. Defaults provenanceKind=manual when omitted in body.",
      inputSchema: z.object({
        skillId: z.string().uuid(),
        cardId: z.string().uuid().optional(),
        body: z.record(z.unknown())
      })
    },
    async ({ skillId, cardId, body }) => {
      try {
        const requestBody = {
          provenanceKind: "manual",
          ...body
        };
        const payload =
          cardId === undefined
            ? await client.requestJson({
                method: "POST",
                path: `/api/v1/admin/skills/${skillId}/knowledge-cards`,
                body: requestBody
              })
            : await client.requestJson({
                method: "PATCH",
                path: `/api/v1/admin/skills/${skillId}/knowledge-cards/${cardId}`,
                body: requestBody
              });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_document_upload",
    {
      description: "Upload a PDF or document file to a Skill knowledge base.",
      inputSchema: z.object({
        skillId: z.string().uuid(),
        filePath: z.string().min(1),
        displayName: z.string().optional(),
        description: z.string().optional()
      })
    },
    async ({ skillId, filePath, displayName, description }) => {
      try {
        const payload = await client.uploadSkillDocument({
          skillId,
          filePath,
          displayName: displayName ?? null,
          description: description ?? null
        });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "skill_scenario_upsert",
    {
      description: "Create or update a Skill scenario with the full API schema (all step fields).",
      inputSchema: z.object({
        skillId: z.string().uuid(),
        scenarioKey: z.string().optional(),
        body: z.record(z.unknown())
      })
    },
    async ({ skillId, scenarioKey, body }) => {
      try {
        const payload =
          scenarioKey === undefined
            ? await client.requestJson({
                method: "POST",
                path: `/api/v1/admin/skills/${skillId}/scenarios`,
                body
              })
            : await client.requestJson({
                method: "PATCH",
                path: `/api/v1/admin/skills/${skillId}/scenarios/${scenarioKey}`,
                body
              });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "indexing_wait",
    {
      description:
        "Poll knowledge indexing jobs until completed/failed or timeout. Provide jobIds and/or skillId.",
      inputSchema: z.object({
        jobIds: z.array(z.string().uuid()).optional(),
        skillId: z.string().uuid().optional(),
        timeoutMs: z.number().int().positive().optional()
      })
    },
    async ({ jobIds, skillId, timeoutMs }) => {
      try {
        const pending = new Set(jobIds ?? []);
        if (pending.size === 0 && skillId === undefined) {
          throw new Error("Provide at least one jobId or skillId.");
        }

        const deadline = Date.now() + (timeoutMs ?? config.indexingTimeoutMs);
        const snapshots: unknown[] = [];

        while (Date.now() < deadline) {
          const jobsPayload = await client.requestJson({
            method: "GET",
            path: "/api/v1/admin/knowledge-indexing/jobs"
          });
          const jobsRow = asRecord(jobsPayload);
          const jobs = Array.isArray(jobsRow?.jobs) ? jobsRow.jobs : [];

          let skillReady = skillId === undefined;
          let skillFailedItems: unknown[] = [];
          if (skillId !== undefined) {
            const skillPayload = await client.requestJson({
              method: "GET",
              path: `/api/v1/admin/skills/${skillId}`
            });
            snapshots.push(skillPayload);
            const skillRow = asRecord(skillPayload);
            const skill = asRecord(skillRow?.skill);
            const documents = Array.isArray(skill?.documents) ? skill.documents : [];
            const cards = Array.isArray(skill?.knowledgeCards) ? skill.knowledgeCards : [];
            const isFailedStatus = (status: unknown) => {
              const normalized = String(status ?? "");
              return normalized === "failed" || normalized === "needs_review";
            };
            skillFailedItems = [...documents, ...cards].filter((item) =>
              isFailedStatus(asRecord(item)?.status)
            );
            const docProcessing = documents.some((item) => asRecord(item)?.status === "processing");
            const cardProcessing = cards.some((item) => asRecord(item)?.status === "processing");
            skillReady =
              skillFailedItems.length === 0 && !docProcessing && !cardProcessing;
          }

          if (skillFailedItems.length > 0) {
            return toolText({
              ready: false,
              skillFailed: true,
              failedItems: skillFailedItems,
              skillId
            });
          }

          const trackedJobs =
            pending.size > 0
              ? jobs.filter((job) => pending.has(String(asRecord(job)?.id ?? "")))
              : [];

          const trackedJobIds = new Set(
            trackedJobs.map((job) => String(asRecord(job)?.id ?? ""))
          );
          const missingJobIds = [...pending].filter((jobId) => !trackedJobIds.has(jobId));

          const incomplete = trackedJobs.filter((job) => {
            const status = String(asRecord(job)?.status ?? "");
            return status !== "completed" && status !== "failed" && status !== "cancelled";
          });

          const jobsReady =
            pending.size === 0 || (missingJobIds.length === 0 && incomplete.length === 0);
          if (jobsReady && skillReady) {
            return toolText({
              ready: true,
              jobs: trackedJobs,
              skillId: skillId ?? null
            });
          }

          const failed = trackedJobs.filter(
            (job) => asRecord(job)?.status === "failed" || asRecord(job)?.status === "needs_review"
          );
          if (failed.length > 0) {
            return toolText({ ready: false, failed, jobs: trackedJobs });
          }

          await sleep(config.indexingPollIntervalMs);
        }

        return toolText({
          ready: false,
          timedOut: true,
          jobIds: [...pending],
          skillId: skillId ?? null,
          lastSnapshots: snapshots.slice(-1),
          note:
            pending.size > 0
              ? "Some jobIds may be outside the admin jobs list page; retry with skillId or wait for list visibility."
              : null
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "assistant_skills_assign",
    {
      description:
        "Assign Skills to the operator actor's active assistant. Merges skillIds into current assignments.",
      inputSchema: z.object({
        skillIds: z.array(z.string().uuid()).min(1)
      })
    },
    async ({ skillIds }) => {
      try {
        const current = await client.requestJson({
          method: "GET",
          path: "/api/v1/assistant/skills"
        });
        const currentRow = asRecord(current);
        const existing = Array.isArray(currentRow?.assignedSkillIds)
          ? currentRow.assignedSkillIds.map(String)
          : [];
        const merged = [...new Set([...existing, ...skillIds])];
        const payload = await client.requestJson({
          method: "PUT",
          path: "/api/v1/assistant/skills",
          body: { skillIds: merged }
        });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "assistant_publish",
    {
      description: "Publish the active assistant draft and materialize the runtime bundle.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const payload = await client.requestJson({
          method: "POST",
          path: "/api/v1/assistant/publish",
          body: {}
        });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_stage_attachment",
    {
      description:
        "Stage a local file for the next web chat turn (same clientTurnId as chat_smoke).",
      inputSchema: z.object({
        surfaceThreadKey: z.string().min(1),
        clientTurnId: z.string().min(1),
        filePath: z.string().min(1),
        clientAttachmentId: z.string().optional()
      })
    },
    async ({ surfaceThreadKey, clientTurnId, filePath, clientAttachmentId }) => {
      try {
        const payload = await client.uploadChatStageAttachment({
          surfaceThreadKey,
          clientTurnId,
          filePath,
          clientAttachmentId: clientAttachmentId ?? null
        });
        return toolText(payload);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_fetch_attachment",
    {
      description:
        "Download a chat workspace file by path for Cursor inspection (base64, size-capped).",
      inputSchema: z.object({
        chatId: z.string().uuid(),
        path: z.string().min(1)
      })
    },
    async ({ chatId, path }) => {
      try {
        const encodedPath = encodeURIComponent(path);
        const { buffer, contentType } = await client.requestBinary({
          path: `/api/v1/assistant/chats/web/${chatId}/files/preview?path=${encodedPath}`
        });
        const truncated = buffer.length > config.attachmentFetchMaxBytes;
        const slice = truncated ? buffer.subarray(0, config.attachmentFetchMaxBytes) : buffer;
        return toolText({
          chatId,
          path,
          contentType,
          sizeBytes: buffer.length,
          truncated,
          base64: slice.toString("base64")
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "chat_smoke",
    {
      description:
        "Send a sync web chat turn. Optionally stage attachmentPaths first. Returns full transport for Cursor evaluation against goal.",
      inputSchema: z.object({
        message: z.string().min(1),
        surfaceThreadKey: z.string().min(1).optional(),
        clientTurnId: z.string().min(1).optional(),
        attachmentPaths: z.array(z.string().min(1)).optional(),
        goal: z.string().optional()
      })
    },
    async ({ message, surfaceThreadKey, clientTurnId, attachmentPaths, goal }) => {
      try {
        const threadKey = surfaceThreadKey ?? `mcp-smoke-${randomUUID()}`;
        const turnId = clientTurnId ?? randomUUID();
        const staged: unknown[] = [];

        if (attachmentPaths !== undefined) {
          for (const filePath of attachmentPaths) {
            staged.push(
              await client.uploadChatStageAttachment({
                surfaceThreadKey: threadKey,
                clientTurnId: turnId,
                filePath
              })
            );
          }
        }

        const payload = await client.requestJson({
          method: "POST",
          path: "/api/v1/assistant/chat/web",
          timeoutMs: config.chatTimeoutMs,
          body: {
            surfaceThreadKey: threadKey,
            message,
            clientTurnId: turnId
          }
        });

        const root = asRecord(payload);
        const transport = asRecord(root?.transport);
        const chat = asRecord(transport?.chat);

        const result = {
          goal: goal ?? null,
          thread: {
            surfaceThreadKey: threadKey,
            chatId: chat?.id ?? null,
            clientTurnId: turnId
          },
          stagedAttachments: staged,
          userMessage: mapMessage(transport?.userMessage),
          assistantMessage: mapMessage(transport?.assistantMessage),
          skillState: chat?.skillDecisionState ?? null,
          engagementSummary: transport?.engagementSummary ?? null,
          turnRouting: asRecord(transport?.runtime)?.turnRouting ?? null,
          activeMediaJobs: transport?.activeMediaJobs ?? [],
          activeDocumentJobs: transport?.activeDocumentJobs ?? [],
          evaluationHint:
            "Compare assistantMessage, attachments, and toolInvocations to goal. PASS/FAIL is model-owned."
        };

        return toolText(result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}
