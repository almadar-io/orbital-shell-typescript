import { describe, expect, it } from 'vitest';
import type { FrameWire } from '@almadar/core/kernel-wire';
import type { EventResponse } from '@almadar/core';
import { createTickDriver, type TickKernelPort } from '../src/kernel/tick-driver.js';

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

const frameJson = (n: number): string => {
  const frame: FrameWire = {
    fired: { O: [{ trait: "T", tick: `t${n}` }] },
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
  const foldGate: { current: Promise<void> } = { current: Promise.resolve() };
  const driver = createTickDriver({
    kernel,
    client: {
      foldLocalResponse: async (_response: EventResponse) => {
        folded.push('fold');
        await foldGate.current;
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
    calls, folded, foldGate, driver, rafs, tickRaf,
    setCount: (n: number) => { count = n; },
    setHidden: (h: boolean) => { hidden = h; listener?.(); },
  };
}

describe('tick driver (poll mode)', () => {
  it('runs one frame per animation frame and folds the result', async () => {
    const r = rig(1);
    r.driver.start();
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@16']);
    expect(r.folded).toEqual(['fold']);  // aggregate only: the fixture has no dispatches
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@16', 'frame@32']);
  });

  it('a frame still folding skips the animation frames that arrive meanwhile, and the next one runs after it', async () => {
    const r = rig(1);
    r.driver.start();
    let finish: () => void = () => undefined;
    r.foldGate.current = new Promise<void>((resolve) => { finish = resolve; });
    await r.tickRaf();
    await r.tickRaf();
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@16']);
    finish();
    r.foldGate.current = Promise.resolve();
    await flush();
    await r.tickRaf();
    expect(r.calls).toEqual(['frame@16', 'frame@64']);
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
