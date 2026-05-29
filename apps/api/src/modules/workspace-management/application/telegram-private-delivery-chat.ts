export function readTelegramBindingMetadata(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }
  return metadata as Record<string, unknown>;
}

/**
 * Resolve the assistant owner's private Telegram DM for notifications and reminders.
 * Group/supergroup targets are intentionally ignored.
 */
export function resolveTelegramPrivateDeliveryChatId(
  metadata: Record<string, unknown> | null
): string | null {
  if (!metadata) {
    return null;
  }

  const dmChatId =
    typeof metadata.telegramDmChatId === "string" ? metadata.telegramDmChatId.trim() : "";
  if (dmChatId) {
    return dmChatId;
  }

  const ownerChatId =
    typeof metadata.telegramOwnerTelegramChatId === "string"
      ? metadata.telegramOwnerTelegramChatId.trim()
      : "";
  if (ownerChatId) {
    return ownerChatId;
  }

  const legacyChatId =
    typeof metadata.reminderDeliveryChatId === "string"
      ? metadata.reminderDeliveryChatId.trim()
      : "";
  const legacyChatType =
    typeof metadata.reminderDeliveryChatType === "string"
      ? metadata.reminderDeliveryChatType.trim()
      : "";
  if (legacyChatId && legacyChatType === "private") {
    return legacyChatId;
  }

  return null;
}

export function resolveTelegramPrivateDeliveryUsername(
  metadata: Record<string, unknown> | null
): string | null {
  if (!metadata) {
    return null;
  }

  const dmUsername =
    typeof metadata.telegramDmUsername === "string" ? metadata.telegramDmUsername.trim() : "";
  if (dmUsername) {
    return dmUsername;
  }

  const ownerUsername =
    typeof metadata.telegramOwnerTelegramUsername === "string"
      ? metadata.telegramOwnerTelegramUsername.trim()
      : "";
  if (ownerUsername) {
    return ownerUsername;
  }

  const legacyUsername =
    typeof metadata.reminderDeliveryUsername === "string"
      ? metadata.reminderDeliveryUsername.trim()
      : "";
  const legacyChatType =
    typeof metadata.reminderDeliveryChatType === "string"
      ? metadata.reminderDeliveryChatType.trim()
      : "";
  return legacyChatType === "private" && legacyUsername ? legacyUsername : null;
}
