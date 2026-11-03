/**
 * The kernel's evaluator as a typed host operation.
 *
 * `@almadar/kernel` (wasm) and the native add-on export the one Rust evaluator and the one row-access
 * owner as functions over JSON strings. This module is their typed face: it marshals the wire types
 * `orbital-core` generates (`kernel-wire`) so a host never writes a JSON call itself and never carries an
 * evaluator of its own. A render hands its binding context once and every expression it binds in one
 * `evaluateMany` crossing.
 *
 * The module that loads the kernel installs it once (`installKernelEvaluator`); a caller that evaluates
 * before that gets a typed error, never a second evaluator.
 *
 * @packageDocumentation
 */

import type {
  EvalContextWire,
  EvalOutcomeWire,
  EvalTracedWire,
  GuardOutcomeWire,
  MutationOpWire,
  MutationVerdictWire,
  RowBindingWire,
  TraceEffectsWire,
} from './generated/kernel-wire';
import type { VocabularyPack } from './i18n/index';
import type { DependencyLayer } from './dependency-graph';
import { setOwn } from './types/own-key';
import type { CircuitStepResult, EffectTrace, EntityRow, EventPayload, GuardEvaluation, JsonObject, JsonValue, OrbitalSchema, SExpr, TraitDescription, TransitionTrace } from './types/index';

export interface AvlProjectionMachineWire {
  states: readonly { name: string }[];
  transitions: readonly { from: string | readonly string[]; to: string; event: string }[];
}

export interface AvlSceneStepWire {
  orbital: string;
  trait: string;
  from: string;
  result: CircuitStepResult;
}

export interface AvlTransitionPlaybackProjection {
  stepIndex: number;
  fired: boolean;
  guard?: GuardEvaluation;
  effects: EffectTrace[];
}

export interface AvlMachinePlaybackProjection {
  activeState?: string;
  activeTransition?: number;
  visitedStates: string[];
}

export interface AvlTraitLevelWire {
  name: string;
  linkedEntity: string;
  states: { name: string; isInitial: boolean | null; isTerminal: boolean | null }[];
  transitions: { from: string | string[]; to: string; event: string; guard: SExpr | null; effects: { type: string; args: SExpr[] }[]; index: number }[];
  emittedEvents: string[];
  listenedEvents: string[];
}

export interface AvlTraitFlowWire {
  units: { id: string; name: string; column: 'own' | DependencyLayer; traits: string[]; renderPieces: string[] }[];
  edges: { source: string; target: string; events: string[] }[];
}

/** One delivery the program makes between two different traits: `emitterTrait` emits `event` and `listenerTrait` listens to it. */
export interface EventWire {
  emitterOrbital: string;
  emitterTrait: string;
  listenerOrbital: string;
  listenerTrait: string;
  event: string;
}

/** The evaluation functions `@almadar/kernel` (wasm) and the native add-on export, over JSON strings. */
export interface KernelEvaluatorExports {
  evaluateMany(contextJson: string, expressionsJson: string): string;
  resolveValues(contextJson: string, valuesJson: string): string;
  evaluateGuards(contextJson: string, guardsJson: string): string;
  evaluateTraced(contextJson: string, expressionJson: string): string;
  traceEffects(contextJson: string, effectsJson: string): string;
  mapListenPayload(mappingJson: string, payloadJson: string): string;
  scopeRows(bindingsJson: string, rowsJson: string, policyJson: string, filterJson: string, entityType: string): string;
  checkMutationAccess(operation: string, bindingsJson: string, rowJson: string, policyJson: string, entityType: string): string;
  resolveRowBinding(term: string, bindingsJson: string): string;
  eventWires(schemaJson: string): string;
  validatePacks(packsJson: string): void;
  expandFxLayer(layerJson: string, epochNowMs: number, dimension: string, tileWidth?: number, fontFamily?: string): string;
  resolveFxView(itemJson: string, presetsJson?: string): string;
  fxLifecycle(viewJson: string, epochNowMs: number, tickMs: number): string;
  fxHash01(seed: string, salt: number): number;
  avlTransitionPlayback(machineJson: string, transitionIndex: number, orbital: string, traitName: string, sceneJson: string, cursor: number): string;
  avlTracePlayback(machineJson: string, traitName: string, tracesJson: string): string;
  avlStateMachinePlayback(machineJson: string, orbital: string, traitName: string, sceneJson: string, cursor: number): string;
  avlArmIndexes(machineJson: string, from: string, event: string): string;
  avlFiredTransitionIndex(machineJson: string, stepJson: string): string;
  avlTracedTransitionIndex(machineJson: string, traceJson: string): string;
  avlTraitLevelFromDescription(descriptionJson: string): string;
  avlTraitFlowGraph(schemaJson: string, orbital: string, layersJson: string): string;
}

/** An expression the kernel's evaluator rejected. */
export class KernelEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelEvalError';
  }
}

/** A caller evaluated before the module that loads the kernel installed its evaluator. */
export class KernelEvaluatorNotInstalledError extends Error {
  constructor() {
    super('the kernel evaluator is not installed: load @almadar/kernel and call installKernelEvaluator before evaluating');
    this.name = 'KernelEvaluatorNotInstalledError';
  }
}

export interface KernelEvaluator {
  /** Every expression of one render against one context, in one crossing; a failing expression is its own outcome. */
  evaluateMany(context: EvalContextWire, expressions: readonly SExpr[]): EvalOutcomeWire[];
  /** Every prop value of one render resolved in one crossing: each binding (embedded in a string or at any depth) and each operator call. */
  resolveValues(context: EvalContextWire, values: readonly JsonValue[]): EvalOutcomeWire[];
  /** One expression's value; throws `KernelEvalError` with the evaluator's message when it fails. */
  evaluate(context: EvalContextWire, expression: SExpr): JsonValue;
  /** Every guard of one render against one context, in one crossing, by the kernel's truthiness. */
  evaluateGuards(context: EvalContextWire, guards: readonly SExpr[]): GuardOutcomeWire[];
  evaluateGuard(context: EvalContextWire, guard: SExpr): GuardOutcomeWire;
  /** One expression with every node's entry, value and exit by structural path. */
  evaluateTraced(context: EvalContextWire, expression: SExpr): EvalTracedWire;
  /** Effects run in order against the context's row: a trace per effect, the events raised, the writes made and the row after them. */
  traceEffects(context: EvalContextWire, effects: readonly SExpr[]): TraceEffectsWire;
  /** A listen route's `with { field: <expr> }` mapping applied to the source payload, in one crossing. */
  mapListenPayload(mapping: Readonly<Record<string, SExpr>>, payload: EventPayload): EventPayload;
  /** The rows that pass the declared `@read` policy and the call-site filter, under the bindings' viewer. */
  scopeRows<T extends EntityRow>(bindings: EvalContextWire, rows: readonly T[], policy: SExpr | undefined, filter: SExpr | undefined, entityType: string): T[];
  /** Whether `row` may undergo `operation` under the declared directive (no directive allows). */
  checkMutation(operation: MutationOpWire, bindings: EvalContextWire, row: EntityRow, policy: SExpr | undefined, entityType: string): MutationVerdictWire;
  /** What a `@user`/`@payload`/`@config`/`@now` term folds to for a row predicate. */
  resolveRowBinding(term: string, bindings: EvalContextWire): RowBindingWire;
  /** Every emitter-to-listener delivery between two different traits of the program, in schema order, by the source rule the kernel delivers by. */
  eventWires(schema: OrbitalSchema): EventWire[];
  /** The kernel's verdict on a set of language packs: returns when every pack loads, else throws the refusal naming each pack, section and word. */
  validatePacks(packs: readonly LanguagePackWire[]): void;
  /** Pure world FX paint descriptors at the host's epoch paint clock. */
  expandFxLayer(layerJson: string, epochNowMs: number, dimension: '2d' | '3d', tileWidth?: number, fontFamily?: string): string;
  resolveFxView(itemJson: string, presetsJson?: string): string;
  fxLifecycle(viewJson: string, epochNowMs: number, tickMs: number): string;
  fxHash01(seed: string, salt: number): number;
  avlTransitionPlayback(machine: AvlProjectionMachineWire, transitionIndex: number, orbital: string, traitName: string, scene: readonly AvlSceneStepWire[], cursor: number): AvlTransitionPlaybackProjection | null;
  avlTracePlayback(machine: AvlProjectionMachineWire, traitName: string, traces: readonly TransitionTrace[]): AvlMachinePlaybackProjection;
  avlStateMachinePlayback(machine: AvlProjectionMachineWire, orbital: string, traitName: string, scene: readonly AvlSceneStepWire[], cursor: number): AvlMachinePlaybackProjection;
  avlArmIndexes(machine: AvlProjectionMachineWire, from: string, event: string): number[];
  avlFiredTransitionIndex(machine: AvlProjectionMachineWire, step: AvlSceneStepWire): number | null;
  avlTracedTransitionIndex(machine: AvlProjectionMachineWire, trace: TransitionTrace): number | null;
  avlTraitLevelFromDescription(description: TraitDescription): AvlTraitLevelWire | null;
  avlTraitFlowGraph(schema: OrbitalSchema, orbital: string, layers: Readonly<Record<string, DependencyLayer>>): AvlTraitFlowWire;
}

/** One language pack as the kernel's pack check reads it: a label for the refusal and the pack's vocabulary. */
export interface LanguagePackWire {
  package: string;
  definition: VocabularyPack;
}

const optionalJson = (expr: SExpr | undefined): string => (expr === undefined ? '' : JSON.stringify(expr));

export function createKernelEvaluator(kernel: KernelEvaluatorExports): KernelEvaluator {
  const evaluateMany = (context: EvalContextWire, expressions: readonly SExpr[]): EvalOutcomeWire[] => {
    if (expressions.length === 0) return [];
    return JSON.parse(kernel.evaluateMany(JSON.stringify(context), JSON.stringify(expressions))) as EvalOutcomeWire[];
  };
  const evaluateGuards = (context: EvalContextWire, guards: readonly SExpr[]): GuardOutcomeWire[] => {
    if (guards.length === 0) return [];
    return JSON.parse(kernel.evaluateGuards(JSON.stringify(context), JSON.stringify(guards))) as GuardOutcomeWire[];
  };
  return {
    evaluateMany,
    resolveValues(context, values) {
      if (values.length === 0) return [];
      return JSON.parse(kernel.resolveValues(JSON.stringify(context), JSON.stringify(values))) as EvalOutcomeWire[];
    },
    evaluate(context, expression) {
      const outcome = evaluateMany(context, [expression])[0];
      if (outcome.kind === 'error') throw new KernelEvalError(outcome.message);
      return outcome.value;
    },
    evaluateGuards,
    evaluateGuard(context, guard) {
      return evaluateGuards(context, [guard])[0];
    },
    evaluateTraced(context, expression) {
      return JSON.parse(kernel.evaluateTraced(JSON.stringify(context), JSON.stringify(expression))) as EvalTracedWire;
    },
    traceEffects(context, effects) {
      return JSON.parse(kernel.traceEffects(JSON.stringify(context), JSON.stringify(effects))) as TraceEffectsWire;
    },
    mapListenPayload(mapping, payload) {
      return JSON.parse(kernel.mapListenPayload(JSON.stringify(mapping), JSON.stringify(payload))) as EventPayload;
    },
    scopeRows<T extends EntityRow>(bindings: EvalContextWire, rows: readonly T[], policy: SExpr | undefined, filter: SExpr | undefined, entityType: string): T[] {
      if (policy === undefined && filter === undefined) return [...rows];
      return JSON.parse(
        kernel.scopeRows(JSON.stringify(bindings), JSON.stringify(rows), optionalJson(policy), optionalJson(filter), entityType),
      ) as T[];
    },
    checkMutation(operation, bindings, row, policy, entityType) {
      return JSON.parse(
        kernel.checkMutationAccess(operation, JSON.stringify(bindings), JSON.stringify(row), optionalJson(policy), entityType),
      ) as MutationVerdictWire;
    },
    resolveRowBinding(term, bindings) {
      return JSON.parse(kernel.resolveRowBinding(term, JSON.stringify(bindings))) as RowBindingWire;
    },
    eventWires(schema) {
      return JSON.parse(kernel.eventWires(JSON.stringify(schema))) as EventWire[];
    },
    validatePacks(packs) {
      kernel.validatePacks(JSON.stringify(packs));
    },
    expandFxLayer(layerJson, epochNowMs, dimension, tileWidth, fontFamily) {
      return kernel.expandFxLayer(layerJson, epochNowMs, dimension, tileWidth, fontFamily);
    },
    resolveFxView(itemJson, presetsJson) {
      return kernel.resolveFxView(itemJson, presetsJson);
    },
    fxLifecycle(viewJson, epochNowMs, tickMs) {
      return kernel.fxLifecycle(viewJson, epochNowMs, tickMs);
    },
    fxHash01(seed, salt) {
      return kernel.fxHash01(seed, salt);
    },
    avlTransitionPlayback(machine, transitionIndex, orbital, traitName, scene, cursor) {
      return JSON.parse(kernel.avlTransitionPlayback(JSON.stringify(machine), transitionIndex, orbital, traitName, JSON.stringify(scene), cursor)) as AvlTransitionPlaybackProjection | null;
    },
    avlTracePlayback(machine, traitName, traces) {
      return JSON.parse(kernel.avlTracePlayback(JSON.stringify(machine), traitName, JSON.stringify(traces))) as AvlMachinePlaybackProjection;
    },
    avlStateMachinePlayback(machine, orbital, traitName, scene, cursor) {
      return JSON.parse(kernel.avlStateMachinePlayback(JSON.stringify(machine), orbital, traitName, JSON.stringify(scene), cursor)) as AvlMachinePlaybackProjection;
    },
    avlArmIndexes(machine, from, event) {
      return JSON.parse(kernel.avlArmIndexes(JSON.stringify(machine), from, event)) as number[];
    },
    avlFiredTransitionIndex(machine, step) {
      return JSON.parse(kernel.avlFiredTransitionIndex(JSON.stringify(machine), JSON.stringify(step))) as number | null;
    },
    avlTracedTransitionIndex(machine, trace) {
      return JSON.parse(kernel.avlTracedTransitionIndex(JSON.stringify(machine), JSON.stringify(trace))) as number | null;
    },
    avlTraitLevelFromDescription(description) {
      return JSON.parse(kernel.avlTraitLevelFromDescription(JSON.stringify(description))) as AvlTraitLevelWire | null;
    },
    avlTraitFlowGraph(schema, orbital, layers) {
      return JSON.parse(kernel.avlTraitFlowGraph(JSON.stringify(schema), orbital, JSON.stringify(layers))) as AvlTraitFlowWire;
    },
  };
}

let installed: KernelEvaluator | undefined;

/** Install the evaluator over a loaded kernel; a later install replaces the earlier one. */
export function installKernelEvaluator(kernel: KernelEvaluatorExports): KernelEvaluator {
  installed = createKernelEvaluator(kernel);
  return installed;
}

export function hasKernelEvaluator(): boolean {
  return installed !== undefined;
}

/** The installed evaluator; throws `KernelEvaluatorNotInstalledError` before the kernel is loaded. */
export function kernelEvaluator(): KernelEvaluator {
  if (installed === undefined) throw new KernelEvaluatorNotInstalledError();
  return installed;
}

/** The payload an `emit` raised, from the wire: an object is the event payload; any other value reports none. */
export function eventPayloadOf(value: JsonValue | undefined): EventPayload | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as EventPayload) : undefined;
}

/** What may cross into the kernel as a value: JSON, plus a date (sent as its ISO string) and an absent key. */
export type WireInput =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | readonly WireInput[]
  | { readonly [key: string]: WireInput };

/** A value as it crosses into the kernel: a date is its ISO string and an absent key is not sent. */
export function toWireValue(value: WireInput): JsonValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWireValue);
  if (typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) setOwn(out, key, toWireValue(item));
    }
    return out;
  }
  return value;
}

/**
 * A listen entry's `payloadMapping` applied to the source payload by the kernel, in one crossing. No mapping, or no
 * payload, passes the payload through.
 */
export function applyListenMapping(
  payloadMapping: Readonly<Record<string, SExpr>> | undefined,
  payload: EventPayload | undefined,
): EventPayload | undefined {
  if (!payloadMapping || !payload) return payload;
  return kernelEvaluator().mapListenPayload(payloadMapping, payload);
}

/** Kernel exports that call `load` on first use, once: a host pays for the kernel only when something evaluates. */
export function lazyKernelExports(load: () => KernelEvaluatorExports): KernelEvaluatorExports {
  let loaded: KernelEvaluatorExports | undefined;
  const kernel = (): KernelEvaluatorExports => (loaded ??= load());
  return {
    evaluateMany: (context, expressions) => kernel().evaluateMany(context, expressions),
    resolveValues: (context, values) => kernel().resolveValues(context, values),
    evaluateGuards: (context, guards) => kernel().evaluateGuards(context, guards),
    evaluateTraced: (context, expression) => kernel().evaluateTraced(context, expression),
    traceEffects: (context, effects) => kernel().traceEffects(context, effects),
    mapListenPayload: (mapping, payload) => kernel().mapListenPayload(mapping, payload),
    scopeRows: (bindings, rows, policy, filter, entityType) => kernel().scopeRows(bindings, rows, policy, filter, entityType),
    checkMutationAccess: (operation, bindings, row, policy, entityType) =>
      kernel().checkMutationAccess(operation, bindings, row, policy, entityType),
    resolveRowBinding: (term, bindings) => kernel().resolveRowBinding(term, bindings),
    eventWires: (schemaJson) => kernel().eventWires(schemaJson),
    validatePacks: (packsJson) => kernel().validatePacks(packsJson),
    expandFxLayer: (layer, epoch, dimension, tileWidth, fontFamily) => kernel().expandFxLayer(layer, epoch, dimension, tileWidth, fontFamily),
    resolveFxView: (item, presets) => kernel().resolveFxView(item, presets),
    fxLifecycle: (view, epoch, tickMs) => kernel().fxLifecycle(view, epoch, tickMs),
    fxHash01: (seed, salt) => kernel().fxHash01(seed, salt),
    avlTransitionPlayback: (machine, index, orbital, traitName, scene, cursor) => kernel().avlTransitionPlayback(machine, index, orbital, traitName, scene, cursor),
    avlTracePlayback: (machine, traitName, traces) => kernel().avlTracePlayback(machine, traitName, traces),
    avlStateMachinePlayback: (machine, orbital, traitName, scene, cursor) => kernel().avlStateMachinePlayback(machine, orbital, traitName, scene, cursor),
    avlArmIndexes: (machine, from, event) => kernel().avlArmIndexes(machine, from, event),
    avlFiredTransitionIndex: (machine, step) => kernel().avlFiredTransitionIndex(machine, step),
    avlTracedTransitionIndex: (machine, trace) => kernel().avlTracedTransitionIndex(machine, trace),
    avlTraitLevelFromDescription: (description) => kernel().avlTraitLevelFromDescription(description),
    avlTraitFlowGraph: (schema, orbital, layers) => kernel().avlTraitFlowGraph(schema, orbital, layers),
  };
}
