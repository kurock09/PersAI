import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { CloudpaymentsWebhookController } from "../src/modules/workspace-management/interface/http/cloudpayments-webhook.controller";

async function run(): Promise<void> {
  const responses: Array<{ statusCode: number; payload: unknown }> = [];
  const response = {
    status(code: number) {
      return {
        json(payload: unknown) {
          responses.push({ statusCode: code, payload });
        }
      };
    }
  };

  const successController = new CloudpaymentsWebhookController({
    handle: async () => ({ status: "processed" })
  } as never);
  await successController.handle(
    "pay",
    { body: {}, rawBody: Buffer.from("{}", "utf8"), headers: {} },
    response
  );
  assert.deepEqual(responses[0], { statusCode: 200, payload: { code: 0 } });

  const forbiddenController = new CloudpaymentsWebhookController({
    handle: async () => {
      throw new ForbiddenException("bad signature");
    }
  } as never);
  await forbiddenController.handle(
    "pay",
    { body: {}, rawBody: Buffer.from("{}", "utf8"), headers: {} },
    response
  );
  assert.deepEqual(responses[1], {
    statusCode: 403,
    payload: { code: 13, message: "webhook_failed" }
  });

  const errorController = new CloudpaymentsWebhookController({
    handle: async () => {
      throw new Error("boom");
    }
  } as never);
  await errorController.handle(
    "pay",
    { body: {}, rawBody: Buffer.from("{}", "utf8"), headers: {} },
    response
  );
  assert.deepEqual(responses[2], {
    statusCode: 500,
    payload: { code: 13, message: "webhook_failed" }
  });

  const invalidTypeController = new CloudpaymentsWebhookController({
    handle: async () => ({ status: "processed" })
  } as never);
  await invalidTypeController.handle(
    "unknown",
    { body: {}, rawBody: Buffer.from("{}", "utf8"), headers: {} },
    response
  );
  assert.deepEqual(responses[3], {
    statusCode: 404,
    payload: { code: 13, message: "unsupported_notification_type" }
  });
}

void run();
