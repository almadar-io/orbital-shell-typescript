/**
 * AVL play — maps played circuit steps (`CircuitStepResult`, produced by
 * `@almadar-io/verify`'s `playCircuitStep`) onto what the AVL views draw.
 * Pure mapping; the host plays.
 */

import type { CircuitStepResult, EffectTrace, EventKey, EventPayload, GuardEvaluation, TraitDescription, TransitionTrace } from '@almadar/core';
import { traitLevelFromDescription, type TraitLevelData, type TraitTransitionInfo } from './avl-schema-parser';

/** One played step of a scene, as the host recorded it. */
export interface AvlPlayStep {
  orbital: string;
  trait: string;
  from: string;
  /** The event the step fired. */
  event: EventKey;
  /** The fired event's payload.
   *  @payloadFor event */
  payload: EventPayload;
  result: CircuitStepResult;
}

/** What a Step control asks the host to play. */
export type AvlStepRequest = {
  orbital: string;
  trait: string;
  from: string;
  /** The event to fire. */
  event: EventKey;
  /** The event's payload.
   *  @payloadFor event */
  payload: EventPayload;
};

/** The trait's `from --event-->` arms in declaration order — the order `firedArm` / `GuardEvaluation.arm` index. */
export function armsOf(trait: TraitLevelData, from: string, event: string): TraitTransitionInfo[] {
  return trait.transitions.filter((t) => t.from === from && t.event === event);
}

/** Position of `transition` among its own `from --event-->` arms. */
export function armPosition(trait: TraitLevelData, transition: TraitTransitionInfo): number {
  return armsOf(trait, transition.from, transition.event).findIndex((t) => t.index === transition.index);
}

/** The trait transition a step fired, or undefined when no arm fired. */
export function firedTransition(trait: TraitLevelData, step: AvlPlayStep): TraitTransitionInfo | undefined {
  if (step.result.firedArm === undefined || !step.result.transitionFired) return undefined;
  return armsOf(trait, step.from, step.result.event)[step.result.firedArm];
}

const ofTrait = (steps: readonly AvlPlayStep[], orbital: string, trait: string): AvlPlayStep[] =>
  steps.filter((s) => s.orbital === orbital && s.trait === trait);

export interface AvlStateMachinePlayback {
  activeState?: string;
  activeTransition?: number;
  visitedStates: string[];
}

/** State-machine highlights after steps `0..cursor` of the scene, for one trait. */
export function stateMachinePlayback(
  trait: TraitLevelData,
  orbital: string,
  steps: readonly AvlPlayStep[],
  cursor: number,
): AvlStateMachinePlayback {
  const played = ofTrait(steps.slice(0, cursor + 1), orbital, trait.name);
  const visitedStates: string[] = [];
  for (const step of played) {
    for (const state of [step.result.state.before, step.result.state.after]) {
      if (state !== null && visitedStates[visitedStates.length - 1] !== state) visitedStates.push(state);
    }
  }
  const last = played[played.length - 1];
  if (!last) return { visitedStates };
  return {
    activeState: last.result.state.after ?? last.result.state.before ?? undefined,
    activeTransition: firedTransition(trait, last)?.index,
    visitedStates,
  };
}

/** The transition a recorded hop took: the arm the kernel reported, or the only `from --event-->` arm entering the hop's target. */
export function tracedTransition(trait: TraitLevelData, trace: TransitionTrace): TraitTransitionInfo | undefined {
  const arms = armsOf(trait, trace.from, trace.event);
  const arm = trace.firedArm;
  if (arm !== undefined) return arms[arm];
  const entering = arms.filter((t) => t.to === trace.to);
  return entering.length === 1 ? entering[0] : undefined;
}

/** State-machine highlights after every recorded hop of one trait (the runtime debugger's live view). */
export function tracePlayback(trait: TraitLevelData, traces: readonly TransitionTrace[]): AvlStateMachinePlayback {
  const hops = traces.filter((t) => t.traitName === trait.name);
  const visitedStates: string[] = [];
  for (const hop of hops) {
    for (const state of [hop.from, hop.to]) {
      if (visitedStates[visitedStates.length - 1] !== state) visitedStates.push(state);
    }
  }
  const last = hops[hops.length - 1];
  if (!last) return { visitedStates };
  return { activeState: last.to, activeTransition: tracedTransition(trait, last)?.index, visitedStates };
}

/** The 1-based lines `orb` printed for `running`'s `transition`: the described arm at the same position among its `from --event-->` arms. */
export function describedTransitionLines(
  description: TraitDescription,
  running: TraitLevelData,
  transition: TraitTransitionInfo,
): { start: number; end: number } | undefined {
  const printed = traitLevelFromDescription(description);
  if (!printed || !description.source) return undefined;
  const match = armsOf(printed, transition.from, transition.event)[armPosition(running, transition)];
  const lines = match ? description.source.transitions.find((l) => l.index === match.index) : undefined;
  return lines ? { start: lines.start, end: lines.end } : undefined;
}

export interface AvlTransitionPlayback {
  step: AvlPlayStep;
  /** Whether this transition is the arm that fired. */
  fired: boolean;
  guard?: GuardEvaluation;
  /** Per declared effect, in order; empty when the arm did not fire. */
  effects: ReadonlyArray<EffectTrace>;
}

/** The latest step within `0..cursor` that evaluated `transition` (its guard ran, or it fired). */
export function transitionPlayback(
  trait: TraitLevelData,
  orbital: string,
  transition: TraitTransitionInfo,
  steps: readonly AvlPlayStep[],
  cursor: number,
): AvlTransitionPlayback | undefined {
  const arm = armPosition(trait, transition);
  const played = ofTrait(steps.slice(0, cursor + 1), orbital, trait.name);
  for (let i = played.length - 1; i >= 0; i--) {
    const step = played[i];
    if (step.from !== transition.from || step.result.event !== transition.event) continue;
    const fired = step.result.transitionFired && step.result.firedArm === arm;
    const guard = step.result.guards?.find((g) => g.arm === arm);
    if (fired || guard) return { step, fired, ...(guard ? { guard } : {}), effects: fired ? step.result.effects : [] };
  }
  return undefined;
}
