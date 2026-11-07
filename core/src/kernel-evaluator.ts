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
} from './generated/kernel-wire';
import type { VocabularyPack } from './i18n/index';
import { setOwn } from './types/own-key';
import type { EntityRow, EventPayload, JsonObject, JsonValue, OrbitalSchema, SExpr } from './types/index';

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
  expandFxLayer(layerJson: string, epochNowMs: number, dimension: string, tileWidth: number): string;
  resolveFxView(itemJson: string, presetsJson?: string): string;
  fxLifecycle(viewJson: string, epochNowMs: number, tickMs: number): string;
  fxHash01(seed: string, salt: number): number;
  skinWorldMatrices(bonesJson: string, poseJson: string): string;
  skinVertices(meshJson: string, bindJson: string, currentJson: string): string;
  skinComposeAffine(aJson: string, bJson: string): string;
  skinInvertAffine(matrixJson: string, bone: number): string;
  skinApplyAffine(matrixJson: string, x: number, y: number): string;
  skinTriangleAffine(srcJson: string, dstJson: string): string;
  skinVertexBounds(pointsJson: string): string;
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
  expandFxLayer(layerJson: string, epochNowMs: number, dimension: '2d' | '3d', tileWidth: number): string;
  resolveFxView(itemJson: string, presetsJson?: string): string;
  fxLifecycle(viewJson: string, epochNowMs: number, tickMs: number): string;
  fxHash01(seed: string, salt: number): number;
  skinWorldMatrices(bonesJson: string, poseJson: string): string;
  skinVertices(meshJson: string, bindJson: string, currentJson: string): string;
  skinComposeAffine(aJson: string, bJson: string): string;
  skinInvertAffine(matrixJson: string, bone: number): string;
  skinApplyAffine(matrixJson: string, x: number, y: number): string;
  skinTriangleAffine(srcJson: string, dstJson: string): string;
  skinVertexBounds(pointsJson: string): string;
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
    expandFxLayer(layerJson, epochNowMs, dimension, tileWidth) {
      return kernel.expandFxLayer(layerJson, epochNowMs, dimension, tileWidth);
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
    skinWorldMatrices: (bonesJson, poseJson) => kernel.skinWorldMatrices(bonesJson, poseJson),
    skinVertices: (meshJson, bindJson, currentJson) => kernel.skinVertices(meshJson, bindJson, currentJson),
    skinComposeAffine: (aJson, bJson) => kernel.skinComposeAffine(aJson, bJson),
    skinInvertAffine: (matrixJson, bone) => kernel.skinInvertAffine(matrixJson, bone),
    skinApplyAffine: (matrixJson, x, y) => kernel.skinApplyAffine(matrixJson, x, y),
    skinTriangleAffine: (srcJson, dstJson) => kernel.skinTriangleAffine(srcJson, dstJson),
    skinVertexBounds: (pointsJson) => kernel.skinVertexBounds(pointsJson),
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
    mapListenPayload: (mapping, payload) => kernel().mapListenPayload(mapping, payload),
    scopeRows: (bindings, rows, policy, filter, entityType) => kernel().scopeRows(bindings, rows, policy, filter, entityType),
    checkMutationAccess: (operation, bindings, row, policy, entityType) =>
      kernel().checkMutationAccess(operation, bindings, row, policy, entityType),
    resolveRowBinding: (term, bindings) => kernel().resolveRowBinding(term, bindings),
    eventWires: (schemaJson) => kernel().eventWires(schemaJson),
    validatePacks: (packsJson) => kernel().validatePacks(packsJson),
    expandFxLayer: (layer, epoch, dimension, tileWidth) => kernel().expandFxLayer(layer, epoch, dimension, tileWidth),
    resolveFxView: (item, presets) => kernel().resolveFxView(item, presets),
    fxLifecycle: (view, epoch, tickMs) => kernel().fxLifecycle(view, epoch, tickMs),
    fxHash01: (seed, salt) => kernel().fxHash01(seed, salt),
    skinWorldMatrices: (bones, pose) => kernel().skinWorldMatrices(bones, pose),
    skinVertices: (mesh, bind, current) => kernel().skinVertices(mesh, bind, current),
    skinComposeAffine: (a, b) => kernel().skinComposeAffine(a, b),
    skinInvertAffine: (matrix, bone) => kernel().skinInvertAffine(matrix, bone),
    skinApplyAffine: (matrix, x, y) => kernel().skinApplyAffine(matrix, x, y),
    skinTriangleAffine: (src, dst) => kernel().skinTriangleAffine(src, dst),
    skinVertexBounds: (points) => kernel().skinVertexBounds(points),
  };
}
