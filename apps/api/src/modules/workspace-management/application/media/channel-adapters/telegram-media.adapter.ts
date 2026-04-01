/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from "@nestjs/common";
import type { ChannelMediaAdapter } from "./channel-media-adapter.interface";
import type { ChannelTarget, MediaChannel } from "../media.types";

/**
 * Telegram channel adapter. Delegates media delivery to the OpenClaw
 * Telegram bridge via the internal turn response. The PersAI API
 * returns media artifacts in the turn result, and the bridge
 * (persai-runtime-telegram.ts) calls Grammy sendPhoto/sendVoice/etc.
 *
 * Direct Telegram Bot API calls are intentionally NOT made here —
 * bot token and session live in the OpenClaw fork. This adapter
 * handles any PersAI-side formatting or preparation before the
 * artifacts are included in the turn response.
 */
@Injectable()
export class TelegramMediaAdapter implements ChannelMediaAdapter {
  readonly channel: MediaChannel = "telegram";

  async sendImage(
    _target: ChannelTarget,
    _buffer: Buffer,
    _filename: string,
    _caption?: string
  ): Promise<void> {}

  async sendVoice(_target: ChannelTarget, _buffer: Buffer, _filename: string): Promise<void> {}

  async sendAudio(
    _target: ChannelTarget,
    _buffer: Buffer,
    _filename: string,
    _caption?: string
  ): Promise<void> {}

  async sendDocument(
    _target: ChannelTarget,
    _buffer: Buffer,
    _filename: string,
    _caption?: string
  ): Promise<void> {}

  async sendVideo(
    _target: ChannelTarget,
    _buffer: Buffer,
    _filename: string,
    _caption?: string
  ): Promise<void> {}
}
