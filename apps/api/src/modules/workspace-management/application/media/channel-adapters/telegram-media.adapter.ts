/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from "@nestjs/common";
import type { ChannelMediaAdapter } from "./channel-media-adapter.interface";
import type { ChannelTarget, MediaChannel } from "../media.types";

/**
 * Telegram media persistence adapter.
 *
 * During Step 13, direct Telegram Bot API delivery moved into the
 * API-side Telegram adapter / bot client path. `MediaDeliveryService`
 * still uses this adapter slot only for canonical attachment
 * persistence bookkeeping, so the send methods remain no-op.
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
