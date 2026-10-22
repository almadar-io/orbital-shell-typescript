/**
 * Coverage of the INIT-filter fix in `buildEdgeCoveringWalk`.
 *
 * Before the fix, every transition with `event === 'INIT'` was dropped
 * before the walker ever saw it. That hid user-triggered re-init edges
 * (e.g. `browsing+INIT->loading` for refresh, `error+INIT->loading`
 * for retry) from coverage entirely. The runtime auto-fires INIT only
 * from the initial state on mount, so the walker still doesn't need
 * to fire that one — but the others MUST be walkable.
 *
 * After the fix the filter drops only `INIT && from === initialState`.
 * These tests pin all four cases so the fix can't silently regress.
 */

import { describe, it, expect } from 'vitest';
import { buildEdgeCoveringWalk } from '../src/state-machine/edge-walk.js';
import type { EdgeWalkTransition, WalkStep } from '../src/state-machine/types.js';

function transition(from: string, event: string, to: string): EdgeWalkTransition {
  return { from, event, to, hasGuard: false };
}

function coversEdge(walk: WalkStep[], from: string, event: string, to: string): boolean {
  return walk.some(
    (step) =>
      step.from === from &&
      step.event === event &&
      step.to === to &&
      !step.isRepositioning,
  );
}

describe('buildEdgeCoveringWalk INIT filter', () => {
  it('case 1: no INIT transitions at all — graph unchanged', () => {
    // loading --LOADED--> browsing (no INIT)
    const transitions = [transition('loading', 'LOADED', 'browsing')];
    const walk = buildEdgeCoveringWalk(transitions, 'loading');

    expect(walk.length).toBeGreaterThanOrEqual(1);
    expect(coversEdge(walk, 'loading', 'LOADED', 'browsing')).toBe(true);
  });

  it('case 2: INIT from initialState is dropped (runtime auto-fires it on mount)', () => {
    // loading --INIT--> loading (auto-fired by runtime; walker should NOT walk it)
    // loading --LOADED--> browsing
    const transitions = [
      transition('loading', 'INIT', 'loading'),
      transition('loading', 'LOADED', 'browsing'),
    ];
    const walk = buildEdgeCoveringWalk(transitions, 'loading');

    // Walker covers the LOADED edge but should NOT emit a step for the
    // initial-state INIT (the runtime fires it; the kernel synthesizes
    // a `triggerKind: 'auto-init'` Frame to credit it).
    expect(coversEdge(walk, 'loading', 'LOADED', 'browsing')).toBe(true);
    expect(coversEdge(walk, 'loading', 'INIT', 'loading')).toBe(false);
  });

  it('case 3: INIT from non-initialState IS walkable (refresh/retry edges)', () => {
    // The std-browse pattern. Pre-fix, edges 4 & 5 were invisible.
    // loading --LOADED--> browsing
    // loading --LOAD_FAILED--> error
    // browsing --INIT--> loading      (refresh)
    // error --INIT--> loading         (retry)
    const transitions = [
      transition('loading', 'LOADED', 'browsing'),
      transition('loading', 'LOAD_FAILED', 'error'),
      transition('browsing', 'INIT', 'loading'),
      transition('error', 'INIT', 'loading'),
    ];
    const walk = buildEdgeCoveringWalk(transitions, 'loading');

    expect(coversEdge(walk, 'loading', 'LOADED', 'browsing')).toBe(true);
    expect(coversEdge(walk, 'loading', 'LOAD_FAILED', 'error')).toBe(true);
    expect(coversEdge(walk, 'browsing', 'INIT', 'loading')).toBe(true);
    expect(coversEdge(walk, 'error', 'INIT', 'loading')).toBe(true);
  });

  it('case 4: INIT from `*` (wildcard pseudostate) is dropped like other wildcards', () => {
    // * --INIT--> loading is a pseudostate edge; the existing filter
    // already drops `from === '*'`, and the new filter must keep that.
    const transitions = [
      transition('*', 'INIT', 'loading'),
      transition('loading', 'LOADED', 'browsing'),
    ];
    const walk = buildEdgeCoveringWalk(transitions, 'loading');

    expect(coversEdge(walk, 'loading', 'LOADED', 'browsing')).toBe(true);
    expect(coversEdge(walk, '*', 'INIT', 'loading')).toBe(false);
  });

  it('std-browse exact shape lifts from 3/5 to 5/5 edges visible to the walker', () => {
    // The atom that motivated the fix. All 5 transitions:
    //   loading --INIT--> loading       (boot — auto-fired, NOT walkable)
    //   loading --LOADED--> browsing
    //   loading --LOAD_FAILED--> error
    //   browsing --INIT--> loading      (refresh — newly walkable)
    //   error --INIT--> loading         (retry — newly walkable)
    const transitions = [
      transition('loading', 'INIT', 'loading'),
      transition('loading', 'LOADED', 'browsing'),
      transition('loading', 'LOAD_FAILED', 'error'),
      transition('browsing', 'INIT', 'loading'),
      transition('error', 'INIT', 'loading'),
    ];
    const walk = buildEdgeCoveringWalk(transitions, 'loading');

    // 4 walkable edges (the boot INIT is excluded by design).
    expect(coversEdge(walk, 'loading', 'LOADED', 'browsing')).toBe(true);
    expect(coversEdge(walk, 'loading', 'LOAD_FAILED', 'error')).toBe(true);
    expect(coversEdge(walk, 'browsing', 'INIT', 'loading')).toBe(true);
    expect(coversEdge(walk, 'error', 'INIT', 'loading')).toBe(true);
    expect(coversEdge(walk, 'loading', 'INIT', 'loading')).toBe(false);
  });
});
