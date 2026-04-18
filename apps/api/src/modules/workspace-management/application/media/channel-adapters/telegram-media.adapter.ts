import { Injectable } from "@nestjs/common";
import type { RuntimeMediaArtifact } from "../../assistant-runtime.facade";
import { TelegramBotClientService } from "../../telegram-bot.client.service";
import type { ChannelMediaAdapter } from "./channel-media-adapter.interface";
import type { ChannelTarget, MediaChannel } from "../media.types";

type TelegramAdapterArtifact = Pick<RuntimeMediaArtifact, "type"> & {
  caption?: string;
  audioAsVoice?: boolean;
};
@Injectable()
export class TelegramMediaAdapter implements ChannelMediaAdapter {
  readonly channel: MediaChannel = "telegram";
  constructor(private readonly telegramBotClientService: TelegramBotClientService) {}

  async sendImage(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void> {
    await this.sendTypedMedia(target, buffer, filename, {
      type: "image",
      ...(caption ? { caption } : {})
    });
  }

  async sendVoice(target: ChannelTarget, buffer: Buffer, filename: string): Promise<void> {
    await this.sendTypedMedia(target, buffer, filename, {
      type: "audio",
      audioAsVoice: true
    });
  }

  async sendAudio(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void> {
    await this.sendTypedMedia(target, buffer, filename, {
      type: "audio",
      ...(caption ? { caption } : {})
    });
  }

  async sendDocument(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void> {
    await this.sendTypedMedia(target, buffer, filename, {
      type: "document",
      ...(caption ? { caption } : {})
    });
  }

  async sendVideo(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void> {
    await this.sendTypedMedia(target, buffer, filename, {
      type: "video",
      ...(caption ? { caption } : {})
    });
  }

  private async sendTypedMedia(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    artifact: TelegramAdapterArtifact
  ): Promise<void> {
    const botToken =
      typeof target.metadata?.botToken === "string" ? target.metadata.botToken : null;
    if (!botToken) {
      throw new Error("Telegram media target is missing botToken metadata.");
    }

    await this.telegramBotClientService.sendMedia({
      botToken,
      chatId: String(target.chatId),
      artifact: {
        source: "persai_object_storage",
        objectKey: "",
        filename,
        mimeType: "application/octet-stream",
        sizeBytes: buffer.byteLength,
        ...artifact
      },
      buffer,
      filename
    });
  }
}
