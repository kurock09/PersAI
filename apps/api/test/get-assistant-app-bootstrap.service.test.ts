import assert from "node:assert/strict";
import { UnauthorizedException, NotFoundException } from "@nestjs/common";
import { GetAssistantAppBootstrapService } from "../src/modules/workspace-management/application/get-assistant-app-bootstrap.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

  const userId = "user-bootstrap-1";

  const happyService = new GetAssistantAppBootstrapService(
    {
      async execute(id: string) {
        assert.equal(id, userId);
        return {
          assistant: { sentinel: "assistant" },
          assistants: [{ id: "assistant-1" }],
          activeAssistantId: "assistant-1",
          assistantLimit: { usedAssistants: 1, maxAssistants: 3 }
        } as never;
      }
    } as never,
    {
      async listChats(id: string) {
        assert.equal(id, userId);
        return [{ sentinel: "chat" }] as never;
      }
    } as never,
    {
      async execute(id: string) {
        assert.equal(id, userId);
        return { sentinel: "telegram" } as never;
      }
    } as never,
    {
      async execute(id: string) {
        assert.equal(id, userId);
        return { sentinel: "notif" } as never;
      }
    } as never,
    {
      async getUserVisibility(id: string) {
        assert.equal(id, userId);
        return { sentinel: "user-plan" } as never;
      },
      async getAdminVisibility(id: string) {
        assert.equal(id, userId);
        return { sentinel: "admin-plan" } as never;
      }
    } as never,
    {
      async getState(id: string) {
        assert.equal(id, userId);
        return { sentinel: "billing-subscription" } as never;
      }
    } as never,
    {
      async execute(id: string) {
        assert.equal(id, userId);
        return {
          standing: "none",
          observationEndsAt: null,
          daysRemaining: null,
          reasonCode: null
        };
      }
    } as never
  );

  const happy = await happyService.execute(userId);
  assert.equal(happy.assistant.ok, true);
  if (happy.assistant.ok) {
    assert.deepEqual(happy.assistant.data, {
      assistant: { sentinel: "assistant" },
      assistants: [{ id: "assistant-1" }],
      activeAssistantId: "assistant-1",
      assistantLimit: { usedAssistants: 1, maxAssistants: 3 }
    });
  }
  assert.equal(happy.chats.ok, true);
  assert.equal(happy.telegram.ok, true);
  assert.equal(happy.notificationPreference.ok, true);
  assert.equal(happy.plan.ok, true);
  assert.equal(happy.billingSubscription.ok, true);
  assert.equal(happy.admin.ok, true);
  assert.equal(happy.userSafety.ok, true);

  const partialService = new GetAssistantAppBootstrapService(
    {
      async execute() {
        throw new NotFoundException("No assistant for user.");
      }
    } as never,
    {
      async listChats() {
        return [];
      }
    } as never,
    {
      async execute() {
        return { sentinel: "telegram" } as never;
      }
    } as never,
    {
      async execute() {
        return { sentinel: "notif" } as never;
      }
    } as never,
    {
      async getUserVisibility() {
        return { sentinel: "user-plan" } as never;
      },
      async getAdminVisibility() {
        throw new UnauthorizedException("Not an admin.");
      }
    } as never,
    {
      async getState() {
        return { sentinel: "billing-subscription" } as never;
      }
    } as never,
    {
      async execute() {
        return {
          standing: "none",
          observationEndsAt: null,
          daysRemaining: null,
          reasonCode: null
        };
      }
    } as never
  );

  const partial = await partialService.execute(userId);
  assert.equal(partial.assistant.ok, false);
  if (!partial.assistant.ok) {
    assert.equal(partial.assistant.error.category, "validation");
    assert.equal(partial.assistant.error.code, "not_found");
  }
  assert.equal(partial.chats.ok, true);
  assert.equal(partial.telegram.ok, true);
  assert.equal(partial.notificationPreference.ok, true);
  assert.equal(partial.plan.ok, true);
  assert.equal(partial.billingSubscription.ok, true);
  assert.equal(partial.admin.ok, false);
  assert.equal(partial.userSafety.ok, true);
  if (!partial.admin.ok) {
    assert.equal(partial.admin.error.category, "auth");
    assert.equal(partial.admin.error.code, "auth_required");
  }

  const infraService = new GetAssistantAppBootstrapService(
    {
      async execute() {
        throw new Error("upstream blew up");
      }
    } as never,
    {
      async listChats() {
        throw "string-error";
      }
    } as never,
    {
      async execute() {
        return { sentinel: "telegram" } as never;
      }
    } as never,
    {
      async execute() {
        return { sentinel: "notif" } as never;
      }
    } as never,
    {
      async getUserVisibility() {
        return { sentinel: "user-plan" } as never;
      },
      async getAdminVisibility() {
        return { sentinel: "admin-plan" } as never;
      }
    } as never,
    {
      async getState() {
        return { sentinel: "billing-subscription" } as never;
      }
    } as never,
    {
      async execute() {
        return {
          standing: "none",
          observationEndsAt: null,
          daysRemaining: null,
          reasonCode: null
        };
      }
    } as never
  );

  const infra = await infraService.execute(userId);
  assert.equal(infra.assistant.ok, false);
  if (!infra.assistant.ok) {
    assert.equal(infra.assistant.error.category, "infra");
    assert.equal(infra.assistant.error.message, "upstream blew up");
  }
  assert.equal(infra.chats.ok, false);
  if (!infra.chats.ok) {
    assert.equal(infra.chats.error.category, "unknown");
  }
  assert.equal(infra.admin.ok, true);
}

void run();
