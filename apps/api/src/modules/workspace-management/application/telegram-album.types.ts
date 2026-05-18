export const TELEGRAM_ALBUM_FINALIZE_DELAY_MS = 1_500;
export const TELEGRAM_ALBUM_CLAIM_TTL_MS = 60_000;
export const TELEGRAM_ALBUM_FINALIZER_POLL_INTERVAL_MS = 1_000;
export const TELEGRAM_ALBUM_FINALIZER_BATCH_SIZE = 8;
export const TELEGRAM_ALBUM_FINALIZER_SCHEDULER_KEY = "telegram_album_finalizer";

export type TelegramAlbumFinalizeOutcome = "ok" | "skipped" | "failed";

export type TelegramAlbumPart = {
  fileId: string;
  mimeType: string;
  originalFilename: string | null;
  turnKind: "photo" | "document";
};

export type ClaimedTelegramAlbumCollector = {
  id: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  telegramChatId: string;
  telegramChatType: "private" | "group" | "supergroup";
  telegramUserId: string;
  mediaGroupId: string;
  caption: string | null;
  parts: TelegramAlbumPart[];
  claimToken: string;
};

export function buildTelegramAlbumFallbackMessage(locale: "ru" | "en"): string {
  return locale === "ru" ? "(отправлен альбом)" : "(sent an album)";
}
