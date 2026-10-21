import { describe, it, expect } from 'vitest';
import type { CircuitStepResult, SExpr, TransitionTrace } from '@almadar/core';
import { traced } from '../../../test/ui/helpers/traced';
import type { TraitLevelData } from '../avl-schema-parser';
import { armPosition, firedTransition, stateMachinePlayback, tracePlayback, transitionPlayback, type AvlPlayStep } from '../avl-play';

const IS_I: SExpr = ['=', '@payload.key', 'i'];
const IS_A: SExpr = ['=', '@payload.key', 'a'];
const trait: TraitLevelData = {
  name: 'Modes',
  linkedEntity: 'Editor',
  states: [{ name: 'NORMAL', isInitial: true, isTerminal: null }, { name: 'INSERT', isInitial: null, isTerminal: null }],
  transitions: [
    { from: 'NORMAL', to: 'INSERT', event: 'KEY', guard: IS_I, effects: [{ type: 'set', args: ['@entity.mode', 'insert'] }], index: 0 },
    { from: 'NORMAL', to: 'INSERT', event: 'KEY', guard: IS_A, effects: [], index: 1 },
    { from: 'INSERT', to: 'NORMAL', event: 'ESC', guard: null, effects: [], index: 2 },
    { from: 'NORMAL', to: 'NORMAL', event: 'KEY', guard: null, effects: [], index: 3 },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

const guardRun = (arm: number, guard: SExpr, key: string) => {
  const run = traced(guard, { payload: { key } });
  return { arm, guard, passed: run.value === true, trace: run.trace };
};

function step(from: string, event: string, key: string, result: Omit<CircuitStepResult, 'trait' | 'event' | 'emitted' | 'effects'> & Partial<CircuitStepResult>): AvlPlayStep {
  return {
    orbital: 'EditorOrbital',
    trait: 'Modes',
    from,
    event,
    payload: { key },
    result: { trait: 'Modes', event, effects: [], emitted: [], ...result },
  };
}

const keyA = step('NORMAL', 'KEY', 'a', {
  transitionFired: true,
  guard: 'pass',
  firedArm: 1,
  state: { before: 'NORMAL', after: 'INSERT' },
  guards: [guardRun(0, IS_I, 'a'), guardRun(1, IS_A, 'a')],
});
const esc = step('INSERT', 'ESC', '', { transitionFired: true, guard: 'none', firedArm: 0, state: { before: 'INSERT', after: 'NORMAL' } });
const keyI = step('NORMAL', 'KEY', 'i', {
  transitionFired: true,
  guard: 'pass',
  firedArm: 0,
  state: { before: 'NORMAL', after: 'INSERT' },
  guards: [guardRun(0, IS_I, 'i')],
  effects: [{ type: 'set', args: ['@entity.mode', 'insert'], status: 'executed', evalTrace: traced(['+', 1, 1]).trace }],
});
const blocked = step('NORMAL', 'KEY', 'q', { transitionFired: false, guard: 'fail', state: { before: 'NORMAL', after: 'NORMAL' }, guards: [guardRun(0, IS_I, 'q'), guardRun(1, IS_A, 'q')] });
const scene = [keyA, esc, keyI];

describe('avl-play — played steps onto the AVL views', () => {
  it('arm positions count only the same from --event--> arms, in declaration order', () => {
    expect(trait.transitions.map((t) => armPosition(trait, t))).toEqual([0, 1, 0, 2]);
  });

  it('names the exact transition that fired when several arms share the event', () => {
    expect(firedTransition(trait, keyA)?.index).toBe(1);
    expect(firedTransition(trait, keyI)?.index).toBe(0);
  });

  it('control: a blocked step fired nothing', () => {
    expect(firedTransition(trait, blocked)).toBeUndefined();
  });

  it('state machine at the cursor: active state, last fired transition, visited path', () => {
    expect(stateMachinePlayback(trait, 'EditorOrbital', scene, 1)).toEqual({ activeState: 'NORMAL', activeTransition: 2, visitedStates: ['NORMAL', 'INSERT', 'NORMAL'] });
    expect(stateMachinePlayback(trait, 'EditorOrbital', scene, 2).activeTransition).toBe(0);
  });

  it('control: before any step, and for another trait, nothing is active', () => {
    expect(stateMachinePlayback(trait, 'EditorOrbital', scene, -1)).toEqual({ visitedStates: [] });
    expect(stateMachinePlayback(trait, 'OtherOrbital', scene, 2)).toEqual({ visitedStates: [] });
  });

  it('transition detail: the arm whose guard failed shows that guard run and no effects', () => {
    const p = transitionPlayback(trait, 'EditorOrbital', trait.transitions[0], scene, 0);
    expect(p?.fired).toBe(false);
    expect(p?.guard?.passed).toBe(false);
    expect(p?.effects).toEqual([]);
  });

  it('transition detail: the arm that fired shows its guard and its traced effects', () => {
    const p = transitionPlayback(trait, 'EditorOrbital', trait.transitions[0], scene, 2);
    expect(p?.fired).toBe(true);
    expect(p?.guard?.passed).toBe(true);
    expect(p?.effects[0].evalTrace?.length).toBeGreaterThan(0);
  });

  it('transition detail follows the cursor back in time', () => {
    expect(transitionPlayback(trait, 'EditorOrbital', trait.transitions[1], scene, 0)?.fired).toBe(true);
    expect(transitionPlayback(trait, 'EditorOrbital', trait.transitions[1], scene, 2)?.fired).toBe(true);
    expect(transitionPlayback(trait, 'EditorOrbital', trait.transitions[0], scene, 0)?.step).toBe(keyA);
  });

  it('control: an arm never reached (not evaluated, not fired) has no playback', () => {
    expect(transitionPlayback(trait, 'EditorOrbital', trait.transitions[3], scene, 2)).toBeUndefined();
    expect(transitionPlayback(trait, 'EditorOrbital', trait.transitions[1], [keyI], 0)).toBeUndefined();
  });
});

describe('tracePlayback (the runtime debugger follows recorded transitions)', () => {
  const trace = (from: string, event: string, to: string, extra: Partial<TransitionTrace> = {}): TransitionTrace => ({
    id: `${from}-${event}-${to}`, traitName: 'Modes', from, to, event, effects: [], timestamp: 0, ...extra,
  });
  const observedArm = (firedArm: number): Partial<TransitionTrace> => ({ firedArm });

  it('the last trace sets the active state, and the path collapses repeats', () => {
    const playback = tracePlayback(trait, [trace('NORMAL', 'KEY', 'INSERT', observedArm(0)), trace('INSERT', 'ESC', 'NORMAL'), trace('NORMAL', 'KEY', 'NORMAL', observedArm(2))]);
    expect(playback.activeState).toBe('NORMAL');
    expect(playback.visitedStates).toEqual(['NORMAL', 'INSERT', 'NORMAL']);
    expect(playback.activeTransition).toBe(3);
  });

  it('the kernel-reported arm picks among same-event arms', () => {
    expect(tracePlayback(trait, [trace('NORMAL', 'KEY', 'INSERT', observedArm(1))]).activeTransition).toBe(1);
  });

  it('the target state picks the one same-event arm that enters it', () => {
    expect(tracePlayback(trait, [trace('NORMAL', 'KEY', 'NORMAL')]).activeTransition).toBe(3);
  });

  it('control: same-event arms entering the same state, with no reported arm, light no transition', () => {
    const playback = tracePlayback(trait, [trace('NORMAL', 'KEY', 'INSERT')]);
    expect(playback.activeState).toBe('INSERT');
    expect(playback.activeTransition).toBeUndefined();
  });

  it('a lone arm is the transition without a reported arm', () => {
    expect(tracePlayback(trait, [trace('INSERT', 'ESC', 'NORMAL')]).activeTransition).toBe(2);
  });

  it('control: another trait\'s traces and an event the machine lacks move nothing', () => {
    expect(tracePlayback(trait, [trace('NORMAL', 'KEY', 'INSERT', { traitName: 'Other' })])).toEqual({ visitedStates: [] });
    const unknown = tracePlayback(trait, [trace('NORMAL', 'NOPE', 'NORMAL')]);
    expect(unknown.activeState).toBe('NORMAL');
    expect(unknown.activeTransition).toBeUndefined();
  });
});

