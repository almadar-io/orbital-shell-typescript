import { describe, expect, it } from 'vitest';
import type { FrameWire } from '@almadar/core/kernel-wire';
import type { OrbitalEventResponse } from '@almadar/core';
import { DispatchLane } from '../src/kernel/lane.js';
import { createTickDriver, type TickKernelPort } from '../src/kernel/tick-driver.js';

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

const frameJson = (n: number): string => {
  const frame: FrameWire = {
    fired: [{ trait: 'T', tick: `t${n}` }],
    response: { success: true, transitioned: true, states: { T: 's' }, emittedEvents: [] },
    dispatches: [],
    browserLegs: [],
    droppedServerEffects: 0,
    errors: [],
  };
  return JSON.stringify(frame);
};

function rig(ticks: number) {
  const calls: string[] = [];
  let count = ticks;
  let clock = 0;
  const kernel: TickKernelPort = {
    frame: (now) => { calls.push(`frame@${now}`); return frameJson(calls.length); },
    framePause: () => { calls.push('pause'); },
    frameResume: () => { calls.push('resume'); },
    tickCount: () => count,
  };
  let nextHandle = 1;
  const rafs = new Map<number, (t: number) => void>();
  let hidden = false;
  let listener: (() => void) | undefined;
  const folded: string[] = [];
  const lane = new DispatchLane();
  const driver = createTickDriver({
    kernel,
    lane,
    client: {
      foldLocalResponse: async (_response: OrbitalEventResponse) => {
        folded.push('fold');
      },
    },
    post: undefined,
    now: () => clock,
    requestFrame: (cb) => { const h = nextHandle; nextHandle += 1; rafs.set(h, cb); return h; },
    cancelFrame: (h) => { rafs.delete(h); },
    visibility: { hidden: () => hidden, onChange: (l) => { listener = l; return () => { listener = undefined; }; } },
  });
  const tickRaf = async (): Promise<void> => {
    const entries = [...rafs.entries()];
    rafs.clear();
    clock += 16;
    for (const [, cb] of entries) cb(clock);
    await flush();
  };
  return {
    calls, folded, lane, driver, rafs, tickRaf,
    setCount: (n: number) => { count = n; },
    setHidden: (h: boolean) => { hidden = h; listener?.(); },
  };
}

describe('tick driver (poll mode)', () => {
  it('runs one frame per animation frame, inside a lane turn, and folds the result', async () => {
    const r = rig(1);
    r.driver.start();
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@16']);
    expect(r.folded).toEqual(['fold']);  // aggregate only: the fixture has no dispatches
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@16', 'frame@32']);
  });

  it('queues frames FIFO behind a held lane and keeps only one pending', async () => {
    const r = rig(1);
    r.driver.start();
    const held = await r.lane.enter();
    await r.tickRaf();
    await r.tickRaf();
    await r.tickRaf();
    expect(r.calls).toEqual([]);
    held.release();
    await flush();
    expect(r.calls).toEqual(['frame@48']);
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@48', 'frame@64']);
  });

  it('a frame behind a held lane runs after the earlier turn, not before it', async () => {
    const r = rig(1);
    r.driver.start();
    const order: string[] = [];
    const held = await r.lane.enter();
    await r.tickRaf();
    const second = r.lane.enter().then((g) => { order.push(`other:${r.calls.length}`); g.release(); });
    held.release();
    await second;
    await flush();
    expect(r.calls).toEqual(['frame@16']);
    expect(order).toEqual(['other:1']);
  });

  it('pauses on hidden, stops polling, and resumes with no backlog', async () => {
    const r = rig(1);
    r.driver.start();
    await r.tickRaf();
    r.setHidden(true);
    expect(r.rafs.size).toBe(0);
    await r.tickRaf();
    await r.tickRaf();
    r.setHidden(false);
    expect(r.calls).toEqual(['frame@16', 'pause', 'resume']);
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@16', 'pause', 'resume', 'frame@64']);
  });

  it('control: no loop when tickCount is 0', async () => {
    const r = rig(0);
    r.driver.start();
    expect(r.rafs.size).toBe(0);
    await r.tickRaf();
    expect(r.calls).toEqual([]);
  });

  it('the loop ends when ticks go away, and stop() cancels everything', async () => {
    const r = rig(1);
    r.driver.start();
    r.setCount(0);
    await r.tickRaf();
    expect(r.rafs.size).toBe(0);
    expect(r.calls).toEqual([]);
    r.setCount(1);
    r.driver.start();
    expect(r.rafs.size).toBe(1);
    r.driver.stop();
    expect(r.rafs.size).toBe(0);
  });
});
