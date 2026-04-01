import type { ChannelTarget, MediaChannel } from "../media.types";

export interface ChannelMediaAdapter {
  readonly channel: MediaChannel;

  sendImage(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void>;

  sendVoice(target: ChannelTarget, buffer: Buffer, filename: string): Promise<void>;

  sendAudio(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void>;

  sendDocument(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void>;

  sendVideo(
    target: ChannelTarget,
    buffer: Buffer,
    filename: string,
    caption?: string
  ): Promise<void>;
}

export const CHANNEL_MEDIA_ADAPTERS = Symbol("CHANNEL_MEDIA_ADAPTERS");
