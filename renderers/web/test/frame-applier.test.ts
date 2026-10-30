import { describe, expect, it } from 'vitest';
import type { FrameWire, RoutedLeg } from '@almadar/core/kernel-wire';
import type { EventResponse } from '@almadar/core';
import { applyFrame, decodeFrame, type FramePostPort } from '@almadar/shell-runtime/kernel/frame-applier';

const response = (states: Record<string, string>): FrameWire['response'] => ({
  success: true,
  transitioned: true,
  states,
  emittedEvents: [],
});

const leg: RoutedLeg = {
  orbital: 'Main',
  leg: { event: 'RUN_TICK', targetTrait: 'Editor', clientId: 'tab-1', runTick: { trait: 'Editor', tick: 'autosave' } },
};

const withLeg: FrameWire = {
  fired: { Notes: [{ trait: 'Editor', tick: 'autosave' }] },
  response: response({ Editor: 'editing' }),
  dispatches: [{
    trait: 'Editor',
    orbital: 'Main',
    seed: { trait: 'Editor', event: 'SAVED' },
    response: response({ Editor: 'editing' }),
    serverLegs: [],
    mode: 'hybridClientOnly',
    snapshot: null,
    alreadyDelivered: [],
    awaiting: [],
    statefulLeg: null,
    foldSeeded: [],
  }],
  browserLegs: [leg],
  droppedServerEffects: 2,
  errors: ['tick Editor.autosave: boom'],
};

function fakeKernel() {
  const folded: Array<{ response: EventResponse; traceHops: boolean; notify: boolean }> = [];
  return {
    folded,
    kernel: {
      foldLocalResponse: async (res: EventResponse, traceHops: boolean, notify: boolean) => {
        folded.push({ response: res, traceHops, notify });
      },
    },
  };
}

function fakePost() {
  const posted: string[] = [];
  const sent: RoutedLeg[] = [];
  const post: FramePostPort = {
    postDispatch: async (d) => { posted.push(d.trait); return { clientEffectsByTrait: [] }; },
    sendBrowserLeg: async (l) => { sent.push(l); return { clientEffectsByTrait: [] }; },
  };
  return { post, posted, sent };
}

describe('frame applier', () => {
  it('folds the frame response then each dispatch and sends the browser leg through the post port', async () => {
    const { kernel, folded } = fakeKernel();
    const { post, sent, posted } = fakePost();
    const result = await applyFrame(JSON.stringify(withLeg), kernel, post);
    expect(folded.map((f) => f.traceHops)).toEqual([false, true]);
    expect(folded[0]?.response).toEqual(withLeg.response);
    expect(sent).toEqual([leg]);
    expect(sent[0]?.leg.runTick).toEqual({ trait: 'Editor', tick: 'autosave' });
    expect(posted).toEqual([]);
    expect(result.fired).toEqual(withLeg.fired);
    expect(result.folded).toBe(2);
    expect(result.browserLegs).toBe(1);
    expect(result.droppedServerEffects).toBe(2);
    expect(result.errors).toEqual(['tick Editor.autosave: boom']);
    expect(result.outcomes.map((o) => o.mode)).toEqual(['hybridClientOnly', 'hybridClientOnly', 'hybridClientOnly']);
    expect(result.outcomes[0]?.response).toEqual(withLeg.response);
    expect(result.outcomes[1]?.tickSettled).toBeInstanceOf(Promise);
    expect(result.outcomes[2]?.tickSettled).toBeUndefined();
  });

  it('notifies once per frame: only the last fold asks for it', async () => {
    const [first] = withLeg.dispatches;
    if (first === undefined) throw new Error('fixture has a dispatch');
    const three: FrameWire = { ...withLeg, dispatches: [first, first] };
    const { kernel, folded } = fakeKernel();
    await applyFrame(JSON.stringify(three), kernel, undefined);
    expect(folded.map((f) => f.notify)).toEqual([false, false, true]);
    const { kernel: aggregateOnly, folded: one } = fakeKernel();
    await applyFrame(JSON.stringify({ ...withLeg, dispatches: [] }), aggregateOnly, undefined);
    expect(one.map((f) => f.notify)).toEqual([true]);
  });

  it('control: no due tick is a no-op', async () => {
    const { kernel, folded } = fakeKernel();
    const { post, sent } = fakePost();
    const result = await applyFrame(undefined, kernel, post);
    expect(folded).toEqual([]);
    expect(sent).toEqual([]);
    expect(result).toEqual({ fired: {}, firedCount: 0, folded: 0, browserLegs: 0, droppedServerEffects: 0, outcomes: [], errors: [] });
  });

  it('a frame with only frame writes folds its response and sends no leg', async () => {
    const frame: FrameWire = { ...withLeg, dispatches: [], browserLegs: [], droppedServerEffects: 0, errors: [] };
    const { kernel, folded } = fakeKernel();
    const { post, sent } = fakePost();
    const result = await applyFrame(JSON.stringify(frame), kernel, post);
    expect(folded).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(result.browserLegs).toBe(0);
    expect(result.outcomes).toHaveLength(1);
  });

  it('posts every dispatch that owes a server leg and settles its effects off the frame', async () => {
    const [first] = withLeg.dispatches;
    if (first === undefined) throw new Error('fixture has a dispatch');
    const owing: FrameWire = { ...withLeg, browserLegs: [], dispatches: [{ ...first, serverLegs: [leg] }] };
    const { kernel } = fakeKernel();
    const { post, posted } = fakePost();
    const result = await applyFrame(JSON.stringify(owing), kernel, post);
    expect(posted).toEqual(['Editor']);
    await expect(result.outcomes[1]?.tickSettled).resolves.toEqual({ clientEffectsByTrait: [] });
  });

  it('a failed post settles to undefined and does not fail the frame', async () => {
    const [first] = withLeg.dispatches;
    if (first === undefined) throw new Error('fixture has a dispatch');
    const owing: FrameWire = { ...withLeg, browserLegs: [], dispatches: [{ ...first, statefulLeg: { orbital: 'Main', leg: leg.leg, awaiting: [] } }] };
    const { kernel } = fakeKernel();
    const post: FramePostPort = { postDispatch: async () => { throw new Error('down'); }, sendBrowserLeg: async () => ({}) };
    const result = await applyFrame(JSON.stringify(owing), kernel, post);
    await expect(result.outcomes[1]?.tickSettled).resolves.toBeUndefined();
  });

  it('without a transport nothing is posted and the dispatch outcome has no tickSettled', async () => {
    const [first] = withLeg.dispatches;
    if (first === undefined) throw new Error('fixture has a dispatch');
    const owing: FrameWire = { ...withLeg, dispatches: [{ ...first, serverLegs: [leg] }] };
    const { kernel } = fakeKernel();
    const result = await applyFrame(JSON.stringify(owing), kernel, undefined);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => o.tickSettled === undefined)).toBe(true);
  });

  it('refuses a payload that is not a FrameWire', () => {
    expect(() => decodeFrame(JSON.stringify({ fired: [] }))).toThrow('not a FrameWire');
  });
});
