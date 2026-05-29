import assert from "node:assert/strict";
import {
  resolveTelegramPrivateDeliveryChatId,
  resolveTelegramPrivateDeliveryUsername
} from "../src/modules/workspace-management/application/telegram-private-delivery-chat";

async function run(): Promise<void> {
  assert.equal(
    resolveTelegramPrivateDeliveryChatId({
      telegramDmChatId: "111",
      reminderDeliveryChatId: "-100999",
      reminderDeliveryChatType: "supergroup"
    }),
    "111"
  );

  assert.equal(
    resolveTelegramPrivateDeliveryChatId({
      reminderDeliveryChatId: "-100999",
      reminderDeliveryChatType: "supergroup",
      telegramOwnerTelegramChatId: "491548134"
    }),
    "491548134"
  );

  assert.equal(
    resolveTelegramPrivateDeliveryChatId({
      reminderDeliveryChatId: "222",
      reminderDeliveryChatType: "private"
    }),
    "222"
  );

  assert.equal(
    resolveTelegramPrivateDeliveryChatId({
      reminderDeliveryChatId: "-100999",
      reminderDeliveryChatType: "supergroup"
    }),
    null
  );

  assert.equal(
    resolveTelegramPrivateDeliveryUsername({
      telegramOwnerTelegramUsername: "kurock09"
    }),
    "kurock09"
  );

  console.log("\n✅ All telegram-private-delivery-chat tests passed");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
