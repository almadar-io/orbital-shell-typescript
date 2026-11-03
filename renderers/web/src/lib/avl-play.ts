/**
 * AVL play — maps played circuit steps (`CircuitStepResult`, produced by
 * `@almadar-io/verify`'s `playCircuitStep`) onto what the AVL views draw.
 * Pure mapping; the host plays.
 */

import type { CircuitStepResult, EffectTrace, EventKey, EventPayload, GuardEvaluation, TraitDescription, TransitionTrace } from '@almadar/core';
import { kernelEvaluator, type AvlProjectionMachineWire } from '@almadar/core';
import type { TraitLevelData, TraitTransitionInfo } from './avl-schema-parser';

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
  return kernelEvaluator().avlArmIndexes(machineOf(trait), from, event).map((index) => trait.transitions[index]);
}

/** Position of `transition` among its own `from --event-->` arms. */
export function armPosition(trait: TraitLevelData, transition: TraitTransitionInfo): number {
  const sources = Array.isArray(transition.from) ? transition.from : [transition.from];
  const positions = sources.map((from) => kernelEvaluator().avlArmIndexes(machineOf(trait), from, transition.event)
    .findIndex((index) => trait.transitions[index]?.index === transition.index));
  return positions.length > 0 && positions.every((position) => position === positions[0]) ? positions[0] : -1;
}

/** The trait transition a step fired, or undefined when no arm fired. */
export function firedTransition(trait: TraitLevelData, step: AvlPlayStep): TraitTransitionInfo | undefined {
  const index = kernelEvaluator().avlFiredTransitionIndex(machineOf(trait), step);
  return index === null ? undefined : trait.transitions[index];
}

export interface AvlStateMachinePlayback {
  activeState?: string;
  activeTransition?: number;
  visitedStates: string[];
}

const machineOf = (trait: TraitLevelData): AvlProjectionMachineWire => ({
  states: [],
  transitions: trait.transitions.map(({ from, to, event }) => ({ from, to, event })),
});

const levelPlayback = (trait: TraitLevelData, projected: AvlStateMachinePlayback): AvlStateMachinePlayback => ({
  ...projected,
  ...(projected.activeTransition !== undefined
    ? { activeTransition: trait.transitions[projected.activeTransition]?.index }
    : {}),
});

/** State-machine highlights after steps `0..cursor` of the scene, for one trait. */
export function stateMachinePlayback(
  trait: TraitLevelData,
  orbital: string,
  steps: readonly AvlPlayStep[],
  cursor: number,
): AvlStateMachinePlayback {
  return levelPlayback(trait, kernelEvaluator().avlStateMachinePlayback(machineOf(trait), orbital, trait.name, steps, cursor));
}

/** The transition a recorded hop took: the arm the kernel reported, or the only `from --event-->` arm entering the hop's target. */
export function tracedTransition(trait: TraitLevelData, trace: TransitionTrace): TraitTransitionInfo | undefined {
  const index = kernelEvaluator().avlTracedTransitionIndex(machineOf(trait), trace);
  return index === null ? undefined : trait.transitions[index];
}

/** State-machine highlights after every recorded hop of one trait (the runtime debugger's live view). */
export function tracePlayback(trait: TraitLevelData, traces: readonly TransitionTrace[]): AvlStateMachinePlayback {
  return levelPlayback(trait, kernelEvaluator().avlTracePlayback(machineOf(trait), trait.name, traces));
}

/** The 1-based lines `orb` printed for `running`'s `transition`: the described arm at the same position among its `from --event-->` arms. */
export function describedTransitionLines(
  description: TraitDescription,
  running: TraitLevelData,
  transition: TraitTransitionInfo,
): { start: number; end: number } | undefined {
  return kernelEvaluator().avlDescribedTransitionLines(description, machineOf(running), transition.index) ?? undefined;
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
  const transitionIndex = trait.transitions.findIndex((candidate) => candidate.index === transition.index);
  if (transitionIndex < 0) return undefined;
  const projection = kernelEvaluator().avlTransitionPlayback(machineOf(trait), transitionIndex, orbital, trait.name, steps, cursor);
  if (!projection) return undefined;
  const step = steps[projection.stepIndex];
  if (!step) return undefined;
  return { step, fired: projection.fired, ...(projection.guard ? { guard: projection.guard } : {}), effects: projection.effects };
}
