import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AssistantAsyncJobHandleStateService } from "../src/modules/workspace-management/application/assistant-async-job-handle-state.service";
import { AssistantAsyncJobHandleStateService } from "../src/modules/workspace-management/application/assistant-async-job-handle-state.service";
import {
  EnqueueRuntimeDeferredDocumentJobService,
  type EnqueueRuntimeDeferredDocumentJobInput
} from "../src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service";
import {
  EnqueueRuntimeDeferredMediaJobService,
  type EnqueueRuntimeDeferredMediaJobInput
} from "../src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service";
import { ResolveAssistantAsyncJobService } from "../src/modules/workspace-management/application/resolve-assistant-async-job.service";
import { parseInternalAsyncJobChannel } from "../src/modules/workspace-management/interface/http/internal-runtime-async-jobs.controller";
import { InternalRuntimeAsyncJobsController } from "../src/modules/workspace-management/interface/http/internal-runtime-async-jobs.controller";
import { InternalRuntimeDocumentJobsEnqueueController } from "../src/modules/workspace-management/interface/http/internal-runtime-document-jobs-enqueue.controller";
import { InternalRuntimeMediaJobsEnqueueController } from "../src/modules/workspace-management/interface/http/internal-runtime-media-jobs-enqueue.controller";

const ref = `jr1.media.${"A".repeat(32)}`;
const owned = {
  jobRef: ref,
  assistantId: "a",
  workspaceId: "w",
  chatId: "c",
  channel: "web" as const,
  threadKey: "t"
};

export async function runAssistantAsyncJobHandleTest(): Promise<void> {
  const controllerRoot = path.resolve(
    __dirname,
    "../src/modules/workspace-management/interface/http"
  );
  const migration = readFileSync(
    path.resolve(
      __dirname,
      "../prisma/migrations/20260717210000_adr152_async_job_handles/migration.sql"
    ),
    "utf8"
  );
  assert.equal((migration.match(/CREATE TABLE "assistant_async_job_handles"/g) ?? []).length, 1);
  assert.match(migration, /gen_random_bytes\(24\)/);
  assert.match(migration, /UNIQUE \("job_ref"\)/);
  assert.match(migration, /UNIQUE \("kind", "canonical_job_id"\)/);
  assert.match(migration, /ON CONFLICT \("kind", "canonical_job_id"\) DO NOTHING/);
  assert.match(ref, /^jr1\.(media|document)\.[A-Za-z0-9_-]{32}$/);
  assert.equal(parseInternalAsyncJobChannel("web"), "web");
  assert.equal(parseInternalAsyncJobChannel("telegram"), "telegram");
  assert.equal(parseInternalAsyncJobChannel("max_ru"), "max_ru");
  for (const invalid of [undefined, null, "", "WEB", "other"]) {
    assert.throws(() => parseInternalAsyncJobChannel(invalid), /channel must be one of/);
  }
  for (const controller of [
    "internal-runtime-media-jobs-enqueue.controller.ts",
    "internal-runtime-document-jobs-enqueue.controller.ts"
  ]) {
    assert.match(
      readFileSync(path.join(controllerRoot, controller), "utf8"),
      /@Post\(\["enqueue", "v1\/enqueue"\]\)/,
      `${controller} must retain the legacy route while exposing the versioned ADR-152 route`
    );
  }
  const asyncController = readFileSync(
    path.join(controllerRoot, "internal-runtime-async-jobs.controller.ts"),
    "utf8"
  );
  assert.match(asyncController, /@Post\(\["status", "v1\/status"\]\)/);
  assert.match(asyncController, /@Post\(\["subscribe", "v1\/subscribe"\]\)/);

  for (const fixture of [
    { kind: "media" as const, canonicalStatus: "completion_pending", expected: "pending" },
    { kind: "media" as const, canonicalStatus: "delivered", expected: "completed" },
    { kind: "media" as const, canonicalStatus: "canceled", expected: "cancelled" },
    { kind: "document" as const, canonicalStatus: "ready_for_delivery", expected: "pending" },
    { kind: "document" as const, canonicalStatus: "failed", expected: "failed" },
    { kind: "document" as const, canonicalStatus: "delivered", expected: "completed" }
  ]) {
    const resolver = new ResolveAssistantAsyncJobService(
      fakeState(fixture.kind, fixture.canonicalStatus)
    );
    const result = await resolver.execute(owned);
    assert.equal(result.found, true);
    if (result.found) assert.equal(result.status, fixture.expected);
  }

  const malformed = await new ResolveAssistantAsyncJobService(
    fakeState("media", "delivered")
  ).execute({ ...owned, jobRef: "bad" });
  assert.deepEqual(malformed, { found: false, code: "job_not_found" });
  const foreign = await new ResolveAssistantAsyncJobService(
    fakeState("media", "delivered", true)
  ).execute(owned);
  assert.deepEqual(foreign, malformed, "foreign and malformed handles must be indistinguishable");
  for (const changed of [
    { assistantId: "other" },
    { workspaceId: "other" },
    { chatId: "other" },
    { threadKey: "other" }
  ]) {
    const result = await new ResolveAssistantAsyncJobService(
      fakeState("media", "delivered")
    ).execute({
      ...owned,
      ...changed
    });
    assert.deepEqual(result, malformed);
  }

  await assertAdr152InternalRouteBindings();
}

async function assertAdr152InternalRouteBindings(): Promise<void> {
  const calls = routeBindingCalls;
  calls.media.length = 0;
  calls.document.length = 0;
  calls.status.length = 0;
  calls.subscribe.length = 0;
  const originalToken = process.env.PERSAI_INTERNAL_API_TOKEN;
  const originalAppEnv = process.env.APP_ENV;
  const originalClerkSecretKey = process.env.CLERK_SECRET_KEY;
  process.env.APP_ENV = "local";
  process.env.CLERK_SECRET_KEY = "adr152-route-test-clerk-secret";
  process.env.PERSAI_INTERNAL_API_TOKEN = "adr152-route-test-token";

  // tsx does not emit constructor metadata, unlike the API's production TypeScript build.
  // Supply the production constructor tokens so this isolated Nest app can use the real controllers.
  Reflect.defineMetadata(
    "design:paramtypes",
    [EnqueueRuntimeDeferredMediaJobService],
    InternalRuntimeMediaJobsEnqueueController
  );
  Reflect.defineMetadata(
    "design:paramtypes",
    [EnqueueRuntimeDeferredDocumentJobService],
    InternalRuntimeDocumentJobsEnqueueController
  );
  Reflect.defineMetadata(
    "design:paramtypes",
    [ResolveAssistantAsyncJobService, AssistantAsyncJobHandleStateService],
    InternalRuntimeAsyncJobsController
  );
  const app = await NestFactory.create(Adr152InternalRouteTestModule, {
    logger: false
  });
  try {
    await app.listen(0, "127.0.0.1");
    const baseUrl = await app.getUrl();
    const authorized = { authorization: "Bearer adr152-route-test-token" };

    for (const route of [
      "/api/v1/internal/runtime/media-jobs/enqueue",
      "/api/v1/internal/runtime/media-jobs/v1/enqueue"
    ]) {
      const response = await postJson(baseUrl, route, { route }, authorized);
      assert.equal(response.status, 202, `${route} must bind and preserve the enqueue status`);
      assert.deepEqual(await response.json(), {
        ok: true,
        accepted: true,
        jobId: "media-job",
        jobRef: ref,
        kind: "image"
      });
    }

    for (const route of [
      "/api/v1/internal/runtime/document-jobs/enqueue",
      "/api/v1/internal/runtime/document-jobs/v1/enqueue"
    ]) {
      const response = await postJson(baseUrl, route, { route }, authorized);
      assert.equal(response.status, 202, `${route} must bind and preserve the enqueue status`);
      assert.deepEqual(await response.json(), {
        ok: true,
        accepted: true,
        docId: "document",
        versionId: "version",
        renderJobId: "render-job",
        jobRef: ref,
        documentType: "presentation"
      });
    }

    for (const route of [
      "/api/v1/internal/runtime/async-jobs/status",
      "/api/v1/internal/runtime/async-jobs/v1/status"
    ]) {
      const response = await postJson(baseUrl, route, owned, authorized);
      assert.equal(response.status, 200, `${route} must bind and preserve the status response`);
      assert.deepEqual(await response.json(), { found: false, code: "job_not_found" });
    }

    for (const route of [
      "/api/v1/internal/runtime/async-jobs/subscribe",
      "/api/v1/internal/runtime/async-jobs/v1/subscribe"
    ]) {
      const response = await postJson(baseUrl, route, owned, authorized);
      assert.equal(response.status, 200, `${route} must bind and preserve the subscribe response`);
      assert.deepEqual(await response.json(), {
        outcome: "subscribed",
        continuationClientTurnId: "continuation",
        duplicate: false
      });
    }

    assert.deepEqual(calls.media, [
      { route: "/api/v1/internal/runtime/media-jobs/enqueue" },
      { route: "/api/v1/internal/runtime/media-jobs/v1/enqueue" }
    ]);
    assert.deepEqual(calls.document, [
      { route: "/api/v1/internal/runtime/document-jobs/enqueue" },
      { route: "/api/v1/internal/runtime/document-jobs/v1/enqueue" }
    ]);
    assert.deepEqual(calls.status, [owned, owned]);
    assert.deepEqual(calls.subscribe, [owned, owned]);

    const callsBeforeRejectedRequests = structuredClone(calls);
    const unauthorized = await postJson(baseUrl, "/api/v1/internal/runtime/media-jobs/v1/enqueue", {
      route: "unauthorized"
    });
    assert.equal(unauthorized.status, 401, "the v1 route must retain internal authorization");
    assert.deepEqual(
      calls,
      callsBeforeRejectedRequests,
      "authorization must run before handler effects"
    );

    for (const route of [
      "/api/v1/internal/runtime/media-jobs/v2/enqueue",
      "/api/v1/internal/runtime/document-jobs/v2/enqueue",
      "/api/v1/internal/runtime/async-jobs/v2/status",
      "/api/v1/internal/runtime/async-jobs/v2/subscribe"
    ]) {
      const response = await postJson(baseUrl, route, owned, authorized);
      assert.equal(response.status, 404, `${route} must not bind before handler side effects`);
    }
    assert.deepEqual(
      calls,
      callsBeforeRejectedRequests,
      "unrelated route versions must have no handler effects"
    );
  } finally {
    await app.close();
    if (originalToken === undefined) {
      delete process.env.PERSAI_INTERNAL_API_TOKEN;
    } else {
      process.env.PERSAI_INTERNAL_API_TOKEN = originalToken;
    }
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }
    if (originalClerkSecretKey === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = originalClerkSecretKey;
    }
  }
}

async function postJson(
  baseUrl: string,
  route: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

@Module({
  controllers: [
    InternalRuntimeMediaJobsEnqueueController,
    InternalRuntimeDocumentJobsEnqueueController,
    InternalRuntimeAsyncJobsController
  ],
  providers: [
    {
      provide: EnqueueRuntimeDeferredMediaJobService,
      useValue: {
        parseInput: (payload: unknown) => payload as EnqueueRuntimeDeferredMediaJobInput,
        execute: async (input: EnqueueRuntimeDeferredMediaJobInput) => {
          routeBindingCalls.media.push(input);
          return { accepted: true, jobId: "media-job", jobRef: ref, kind: "image" as const };
        }
      }
    },
    {
      provide: EnqueueRuntimeDeferredDocumentJobService,
      useValue: {
        parseInput: (payload: unknown) => payload as EnqueueRuntimeDeferredDocumentJobInput,
        execute: async (input: EnqueueRuntimeDeferredDocumentJobInput) => {
          routeBindingCalls.document.push(input);
          return {
            accepted: true,
            docId: "document",
            versionId: "version",
            renderJobId: "render-job",
            jobRef: ref,
            documentType: "presentation" as const
          };
        }
      }
    },
    {
      provide: ResolveAssistantAsyncJobService,
      useValue: {
        execute: async (input: unknown) => {
          routeBindingCalls.status.push(input);
          return { found: false, code: "job_not_found" as const };
        }
      }
    },
    {
      provide: AssistantAsyncJobHandleStateService,
      useValue: {
        subscribePending: async (input: unknown) => {
          routeBindingCalls.subscribe.push(input);
          return {
            outcome: "subscribed" as const,
            continuationClientTurnId: "continuation",
            duplicate: false
          };
        }
      }
    }
  ]
})
class Adr152InternalRouteTestModule {}

const routeBindingCalls: {
  media: unknown[];
  document: unknown[];
  status: unknown[];
  subscribe: unknown[];
} = {
  media: [],
  document: [],
  status: [],
  subscribe: []
};

function fakeState(
  kind: "media" | "document",
  status: string,
  foreign = false
): AssistantAsyncJobHandleStateService {
  return {
    observeForCurrentTurn: async (input) => {
      if (
        foreign ||
        input.assistantId !== "a" ||
        input.workspaceId !== "w" ||
        input.chatId !== "c" ||
        input.threadKey !== "t"
      ) {
        return { outcome: "not_found" as const };
      }
      const normalized =
        status === "delivered"
          ? "completed"
          : status === "failed" || status === "expired"
            ? "failed"
            : status === "canceled"
              ? "cancelled"
              : null;
      return normalized === null
        ? { outcome: "pending" as const, jobRef: input.jobRef, kind }
        : {
            outcome: "claimed_current_turn" as const,
            owner: "current_turn" as const,
            jobRef: input.jobRef,
            kind,
            status: normalized,
            errorCode: normalized === "failed" ? "failed" : null,
            message: normalized === "completed" ? "Job completed and was delivered." : "Job failed."
          };
    }
  } as AssistantAsyncJobHandleStateService;
}

void runAssistantAsyncJobHandleTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
