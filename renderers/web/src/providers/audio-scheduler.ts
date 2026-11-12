import { HostAskError, type AudioClockAnswer, type AudioScheduleCommand } from '@almadar/shell-runtime/kernel/host';

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  gainValue: number;
  rateValue: number;
  ended: boolean;
}

let context: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
const voices = new Map<string, Voice>();

function audioContext(): AudioContext | undefined {
  if (context !== undefined) return context;
  if (typeof AudioContext === 'undefined') return undefined;
  context = new AudioContext();
  return context;
}

/** Drops the context, the decoded sources and the voices (test isolation and host teardown). */
export function resetAudioScheduler(): void {
  context = undefined;
  buffers.clear();
  voices.clear();
}

function load(ctx: AudioContext, source: string): Promise<AudioBuffer> {
  const cached = buffers.get(source);
  if (cached !== undefined) return cached;
  const pending = (async () => {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`audio/schedule: ${source} did not load (${response.status})`);
    return ctx.decodeAudioData(await response.arrayBuffer());
  })();
  buffers.set(source, pending);
  pending.catch(() => buffers.delete(source));
  return pending;
}

function begin(ctx: AudioContext, buffer: AudioBuffer, spec: { key: string; at: number; offset: number; duration?: number; rate: number; gain: number }): void {
  const previous = voices.get(spec.key);
  if (previous !== undefined) previous.source.stop(spec.at);
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = spec.rate;
  gain.gain.value = spec.gain;
  source.connect(gain);
  gain.connect(ctx.destination);
  const voice: Voice = { source, gain, gainValue: spec.gain, rateValue: spec.rate, ended: false };
  voices.set(spec.key, voice);
  source.onended = () => {
    voice.ended = true;
  };
  if (spec.duration !== undefined) source.start(spec.at, spec.offset, spec.duration);
  else source.start(spec.at, spec.offset);
}

/** `audio/schedule`: plays exactly the declared commands on the audio-clock timeline; any command it cannot honour fails the ask before anything plays. */
export async function scheduleAudio(commands: readonly AudioScheduleCommand[]): Promise<void> {
  const ctx = audioContext();
  if (ctx === undefined) throw new HostAskError('unavailable', 'audio/schedule: this environment has no AudioContext');
  const known = new Set(voices.keys());
  for (const command of commands) {
    if ('start' in command) known.add(command.start.key);
    else if ('stop' in command) {
      if (!known.has(command.stop.key)) throw new HostAskError('invalid', `audio/schedule: no voice named ${command.stop.key} was started`);
      known.delete(command.stop.key);
    } else if (!known.has(command.ramp.key)) throw new HostAskError('invalid', `audio/schedule: no voice named ${command.ramp.key} was started`);
  }
  try {
    await ctx.resume();
    const decoded = new Map<string, AudioBuffer>();
    for (const command of commands) {
      if ('start' in command && !decoded.has(command.start.source)) decoded.set(command.start.source, await load(ctx, command.start.source));
    }
    for (const command of commands) {
      if ('start' in command) {
        const buffer = decoded.get(command.start.source);
        if (buffer === undefined) throw new HostAskError('unavailable', `audio/schedule: ${command.start.source} was not decoded`);
        begin(ctx, buffer, command.start);
        continue;
      }
      const key = 'stop' in command ? command.stop.key : command.ramp.key;
      const voice = voices.get(key);
      if (voice === undefined) throw new HostAskError('invalid', `audio/schedule: no voice named ${key} was started`);
      if ('stop' in command) {
        if (!voice.ended) voice.source.stop(command.stop.at);
        voices.delete(key);
        continue;
      }
      if (voice.ended) continue;
      const { param, value, at, endAt, curve } = command.ramp;
      const target = param === 'gain' ? voice.gain.gain : voice.source.playbackRate;
      target.setValueAtTime(param === 'gain' ? voice.gainValue : voice.rateValue, at);
      if (curve === 'linear') target.linearRampToValueAtTime(value, endAt);
      else target.exponentialRampToValueAtTime(value, endAt);
      if (param === 'gain') voice.gainValue = value;
      else voice.rateValue = value;
    }
  } catch (error) {
    if (error instanceof HostAskError) throw error;
    throw new HostAskError('unavailable', error instanceof Error ? error.message : String(error));
  }
}

/** `audio/clock`: the audio clock and the wall clock (epoch ms on `performance.timeOrigin + performance.now()`, the canvas clock), read at one instant. */
export async function readAudioClock(): Promise<AudioClockAnswer> {
  const ctx = audioContext();
  if (ctx === undefined) throw new HostAskError('unavailable', 'audio/clock: this environment has no AudioContext');
  if (typeof ctx.getOutputTimestamp === 'function') {
    const { contextTime, performanceTime } = ctx.getOutputTimestamp();
    if (contextTime !== undefined && performanceTime !== undefined) return { audio: contextTime, wall: performance.timeOrigin + performanceTime };
  }
  return { audio: ctx.currentTime, wall: performance.timeOrigin + performance.now() };
}
