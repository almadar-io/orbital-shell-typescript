import { HostAskError } from '@almadar/shell-runtime/kernel/host';

/** What `os/audio-in` asks the microphone for. */
export interface AudioInRequest {
  sampleRate: number;
  channels: number;
}

/** An open microphone: the rate and channel count the device gave, and how to close it. */
export interface AudioInStream {
  rate: number;
  channels: number;
  stop: () => void;
}

const WORKLET = `class OrbitalPcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) this.port.postMessage(input.map((channel) => channel.slice()));
    return true;
  }
}
registerProcessor('orbital-pcm-tap', OrbitalPcmTap);`;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Interleaves the channels and writes each sample as a 16-bit signed little-endian integer. */
function pcm16(blocks: readonly Float32Array[][], channels: number): Uint8Array {
  const frames = blocks.reduce((n, block) => n + (block[0]?.length ?? 0), 0);
  const out = new DataView(new ArrayBuffer(frames * channels * 2));
  let offset = 0;
  for (const block of blocks) {
    const length = block[0]?.length ?? 0;
    for (let i = 0; i < length; i += 1) {
      for (let c = 0; c < channels; c += 1) {
        const sample = Math.max(-1, Math.min(1, (block[c] ?? block[0])[i] ?? 0));
        out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
  }
  return new Uint8Array(out.buffer);
}

/** `os/audio-in` on the web: opens the microphone and hands each ~100 ms of PCM to `onFrame` as base64. */
export async function openAudioIn(request: AudioInRequest, onFrame: (data: string) => void): Promise<AudioInStream> {
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined || typeof AudioContext === 'undefined') {
    throw new HostAskError('unavailable', 'this browser has no microphone input');
  }
  let media: MediaStream;
  try {
    media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: request.channels, sampleRate: request.sampleRate } });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    throw new HostAskError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable', error instanceof Error ? error.message : 'the microphone could not be opened');
  }
  const context = new AudioContext({ sampleRate: request.sampleRate });
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await context.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
  const source = context.createMediaStreamSource(media);
  const tap = new AudioWorkletNode(context, 'orbital-pcm-tap', { channelCount: request.channels, channelCountMode: 'explicit' });
  const batch = Math.max(1, Math.round(context.sampleRate / 10));
  let pending: Float32Array[][] = [];
  let pendingFrames = 0;
  tap.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
    pending.push(event.data);
    pendingFrames += event.data[0]?.length ?? 0;
    if (pendingFrames < batch) return;
    onFrame(toBase64(pcm16(pending, request.channels)));
    pending = [];
    pendingFrames = 0;
  };
  source.connect(tap);
  return {
    rate: context.sampleRate,
    channels: request.channels,
    stop: () => {
      if (pendingFrames > 0) onFrame(toBase64(pcm16(pending, request.channels)));
      pending = [];
      pendingFrames = 0;
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      media.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
