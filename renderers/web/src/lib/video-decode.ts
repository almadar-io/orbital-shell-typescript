import { HostAskError } from '@almadar/shell-runtime/kernel/host';

/** What `os/video-decode` configures the decoder with. */
export interface VideoDecodeConfig {
  codec: string;
  description: Uint8Array<ArrayBuffer>;
  codedWidth: number;
  codedHeight: number;
}

/** One decoded frame as RGBA, rows top to bottom. */
export interface DecodedFrame {
  data: string;
  width: number;
  height: number;
  timestamp: number;
}

/** An open decoder: the size it decodes at, how to queue a sample and how to close it. */
export interface VideoDecodeStream {
  width: number;
  height: number;
  feed: (sample: { data: Uint8Array<ArrayBuffer>; timestamp: number; key: boolean }) => void;
  close: () => void;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** `os/video-decode` on the web: a WebCodecs decoder whose frames are drawn to an OffscreenCanvas and read back as RGBA. */
export async function openVideoDecode(config: VideoDecodeConfig, onFrame: (frame: DecodedFrame) => void, onError: (message: string) => void): Promise<VideoDecodeStream> {
  if (typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new HostAskError('unavailable', 'this browser has no video decoder');
  const decoderConfig: VideoDecoderConfig = { codec: config.codec, description: config.description, codedWidth: config.codedWidth, codedHeight: config.codedHeight };
  const support = await VideoDecoder.isConfigSupported(decoderConfig);
  if (support.supported !== true) throw new HostAskError('unavailable', `this browser cannot decode ${config.codec}`);
  const canvas = new OffscreenCanvas(config.codedWidth, config.codedHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new HostAskError('unavailable', 'no 2D context to read decoded frames from');
  const decoder = new VideoDecoder({
    output: (frame) => {
      const width = frame.displayWidth;
      const height = frame.displayHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.drawImage(frame, 0, 0, width, height);
      const timestamp = frame.timestamp;
      frame.close();
      onFrame({ data: toBase64(new Uint8Array(context.getImageData(0, 0, width, height).data.buffer)), width, height, timestamp });
    },
    error: (error) => onError(error.message),
  });
  decoder.configure(decoderConfig);
  return {
    width: config.codedWidth,
    height: config.codedHeight,
    feed: (sample) => decoder.decode(new EncodedVideoChunk({ type: sample.key ? 'key' : 'delta', timestamp: sample.timestamp, data: sample.data })),
    close: () => {
      if (decoder.state !== 'closed') decoder.close();
    },
  };
}
