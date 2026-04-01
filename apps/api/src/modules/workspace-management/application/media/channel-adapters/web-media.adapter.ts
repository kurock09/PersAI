/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from "@nestjs/common";
import type { ChannelMediaAdapter } from "./channel-media-adapter.interface";
import type { ChannelTarget, MediaChannel } from "../media.types";

/**
 * Web channel adapter. For web, "sending" media means persisting it
 * in workspace storage and creating attachment records — the client
 * fetches via proxy. The actual send operations are no-ops because
 * the SSE transport and proxy download handle delivery.
 */
@Injectable()
export class WebMediaAdapter implements ChannelMediaAdapter {
  readonly channel: MediaChannel = "web";

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
