import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostAskError, type AudioScheduleCommand, type HostAskFailureKind } from '@almadar/shell-runtime/kernel/host';
import { readAudioClock, resetAudioScheduler, scheduleAudio } from '../audio-scheduler';

type Call = [string, ...number[]];

class FakeParam {
  value = 0;
  calls: Call[] = [];
  setValueAtTime(v: number, t: number): void { this.calls.push(['set', v, t]); }
  linearRampToValueAtTime(v: number, t: number): void { this.calls.push(['linear', v, t]); }
  exponentialRampToValueAtTime(v: number, t: number): void { this.calls.push(['exp', v, t]); }
}

class FakeSource {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  starts: number[][] = [];
  stops: number[] = [];
  connect(): void {}
  start(...args: number[]): void { this.starts.push(args); }
  stop(at: number): void { this.stops.push(at); }
}

class FakeGain {
  gain = new FakeParam();
  connect(): void {}
}

class FakeContext {
  static made: FakeContext[] = [];
  static failDecode = false;
  currentTime = 12.5;
  timestamp: { contextTime?: number; performanceTime?: number } | undefined;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number } { return this.timestamp ?? {}; }
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resumed = 0;
  constructor() { FakeContext.made.push(this); }
  resume(): Promise<void> { this.resumed += 1; return Promise.resolve(); }
  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s; }
  createGain(): FakeGain { const g = new FakeGain(); this.gains.push(g); return g; }
  decodeAudioData(): Promise<{ stub: true }> {
    return FakeContext.failDecode ? Promise.reject(new Error('bad audio')) : Promise.resolve({ stub: true });
  }
}

const start = (key: string, extra: Record<string, number> = {}): AudioScheduleCommand => ({ start: { key, source: '/a.ogg', at: 2, offset: 1.5, rate: 0.5, gain: 0.8, ...extra } });

async function failure(run: Promise<unknown>): Promise<{ kind: HostAskFailureKind; message: string } | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return error instanceof HostAskError ? { kind: error.kind, message: error.message } : undefined;
  }
}

describe('audio/schedule and audio/clock host asks', () => {
  beforeEach(() => {
    FakeContext.made = [];
    FakeContext.failDecode = false;
    resetAudioScheduler();
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('start schedules start(at, offset, duration) with rate and gain, on one resumed context', async () => {
    await scheduleAudio([start('a', { duration: 3 })]);
    const ctx = FakeContext.made[0];
    expect(FakeContext.made).toHaveLength(1);
    expect(ctx.resumed).toBe(1);
    expect(ctx.sources[0].starts).toEqual([[2, 1.5, 3]]);
    expect(ctx.sources[0].playbackRate.value).toBe(0.5);
    expect(ctx.gains[0].gain.value).toBe(0.8);
  });

  it('a start with no duration plays to the end, and a decoded source is fetched once', async () => {
    await scheduleAudio([start('a'), start('b')]);
    expect(FakeContext.made[0].sources[0].starts).toEqual([[2, 1.5]]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('starting a playing key stops the old voice at the new at', async () => {
    await scheduleAudio([start('a')]);
    await scheduleAudio([start('a', { at: 7 })]);
    const [first, second] = FakeContext.made[0].sources;
    expect(first.stops).toEqual([7]);
    expect(second.starts).toEqual([[7, 1.5]]);
  });

  it('stop schedules the stop, and stop of an unknown key fails the ask', async () => {
    await scheduleAudio([start('a')]);
    await scheduleAudio([{ stop: { key: 'a', at: 9 } }]);
    expect(FakeContext.made[0].sources[0].stops).toEqual([9]);
    expect(await failure(scheduleAudio([{ stop: { key: 'nope', at: 9 } }]))).toMatchObject({ kind: 'invalid' });
  });

  it('ramp anchors the current value then ramps the named param, linear or exponential', async () => {
    await scheduleAudio([start('a')]);
    await scheduleAudio([
      { ramp: { key: 'a', param: 'gain', value: 0, at: 3, endAt: 4, curve: 'linear' } },
      { ramp: { key: 'a', param: 'rate', value: 2, at: 3, endAt: 5, curve: 'exponential' } },
      { ramp: { key: 'a', param: 'gain', value: 1, at: 6, endAt: 7, curve: 'exponential' } },
    ]);
    const ctx = FakeContext.made[0];
    expect(ctx.gains[0].gain.calls).toEqual([['set', 0.8, 3], ['linear', 0, 4], ['set', 0, 6], ['exp', 1, 7]]);
    expect(ctx.sources[0].playbackRate.calls).toEqual([['set', 0.5, 3], ['exp', 2, 5]]);
  });

  it('ramp of an unknown key fails and plays nothing', async () => {
    expect(await failure(scheduleAudio([start('a'), { ramp: { key: 'x', param: 'gain', value: 0, at: 1, endAt: 2, curve: 'linear' } }]))).toMatchObject({ kind: 'invalid' });
    expect(FakeContext.made[0].sources).toHaveLength(0);
  });

  it('a source that fails to decode fails the ask', async () => {
    FakeContext.failDecode = true;
    expect(await failure(scheduleAudio([start('a')]))).toEqual({ kind: 'unavailable', message: 'bad audio' });
  });

  it('stop of a voice that ended on its own answers ok, then the key is forgotten', async () => {
    await scheduleAudio([start('a')]);
    const source = FakeContext.made[0].sources[0];
    source.onended?.();
    await scheduleAudio([{ stop: { key: 'a', at: 30 } }]);
    expect(source.stops).toEqual([]);
    expect(await failure(scheduleAudio([{ stop: { key: 'a', at: 31 } }]))).toMatchObject({ kind: 'invalid' });
  });

  it('ramp of an ended voice is a no-op ok', async () => {
    await scheduleAudio([start('a')]);
    FakeContext.made[0].sources[0].onended?.();
    await scheduleAudio([{ ramp: { key: 'a', param: 'gain', value: 0, at: 3, endAt: 4, curve: 'linear' } }]);
    expect(FakeContext.made[0].gains[0].gain.calls).toEqual([]);
  });

  it('stop of a never-started key fails, and stopping twice fails the second', async () => {
    expect(await failure(scheduleAudio([{ stop: { key: 'never', at: 1 } }]))).toMatchObject({ kind: 'invalid' });
    await scheduleAudio([start('a')]);
    await scheduleAudio([{ stop: { key: 'a', at: 5 } }]);
    expect(await failure(scheduleAudio([{ stop: { key: 'a', at: 6 } }]))).toMatchObject({ kind: 'invalid' });
  });

  it('clock reads both clocks at one instant from getOutputTimestamp on the canvas clock', async () => {
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(1000);
    const made = vi.fn();
    vi.stubGlobal('AudioContext', class extends FakeContext { constructor() { super(); this.timestamp = { contextTime: 7, performanceTime: 250 }; made(); } });
    expect(await readAudioClock()).toEqual({ audio: 7, wall: 1250 });
    vi.restoreAllMocks();
  });

  it('clock without getOutputTimestamp uses currentTime and timeOrigin + now', async () => {
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(1000);
    vi.spyOn(performance, 'now').mockReturnValue(40);
    vi.stubGlobal('AudioContext', class extends FakeContext { constructor() { super(); this.getOutputTimestamp = undefined; } });
    expect(await readAudioClock()).toEqual({ audio: 12.5, wall: 1040 });
    vi.restoreAllMocks();
  });

  it('clock without an AudioContext fails unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(await failure(readAudioClock())).toMatchObject({ kind: 'unavailable' });
    expect(await failure(scheduleAudio([start('a')]))).toMatchObject({ kind: 'unavailable' });
  });
});
