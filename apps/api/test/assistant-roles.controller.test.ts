import assert from "node:assert/strict";
import { ManageAssistantRolesService } from "../src/modules/workspace-management/application/manage-assistant-roles.service";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { AssistantRolesController } from "../src/modules/workspace-management/interface/http/assistant-roles.controller";

async function run(): Promise<void> {
  const parser = new ManageAssistantRolesService({} as never, {} as never, {} as never);
  let getCalls = 0;
  let putCalls = 0;
  const service = {
    parseAssistantId: (value: unknown) => parser.parseAssistantId(value),
    parseUpdateInput: (value: unknown) => parser.parseUpdateInput(value),
    async getCurrentRole() {
      getCalls += 1;
      return {} as never;
    },
    async putCurrentRole() {
      putCalls += 1;
      return {} as never;
    }
  } as unknown as ManageAssistantRolesService;
  const controller = new AssistantRolesController(service);
  const request = { resolvedAppUser: { id: "user-1" } } as never;

  for (const invoke of [
    () => controller.getCurrentRole(request, "not-a-uuid"),
    () => controller.putCurrentRole(request, "also-not-a-uuid", { roleKey: "writer" })
  ]) {
    await assert.rejects(
      invoke,
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.getStatus() === 400 &&
        error.errorObject.code === "assistant_role_invalid_assistant_id"
    );
  }
  assert.equal(getCalls, 0);
  assert.equal(putCalls, 0);
}

void run();
