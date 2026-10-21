import type { EmitRecord, JsonValue, StepExpectation, Trace, TraceStep } from './types.js';

export interface TraceDifference {
  stepIndex: number;
  field: 'length' | 'trait' | 'event' | 'states' | 'effects' | 'emits';
  expected: JsonValue;
  actual: JsonValue;
}

const CLOCK_MARKER = '<clock>';

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

/** An effect tuple without its trailing `null` placeholders: `['render-ui', slot, pattern]` is the form `@almadar/core` documents and the kernel emits. */
function withoutTrailingNulls(effect: JsonValue): JsonValue {
  if (!Array.isArray(effect)) return effect;
  let end = effect.length;
  while (end > 0 && effect[end - 1] === null) end -= 1;
  return effect.slice(0, end);
}

function sameValue(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function emitsValue(emits: EmitRecord[]): JsonValue {
  return emits.map((e) => ({ event: e.event, payload: e.payload }));
}

export function compareTraces(expected: Trace, actual: Trace): TraceDifference | null {
  const shared = Math.min(expected.steps.length, actual.steps.length);
  for (let i = 0; i < shared; i++) {
    const want = expected.steps[i];
    const got = actual.steps[i];
    if (want.trait !== got.trait) return { stepIndex: i, field: 'trait', expected: want.trait, actual: got.trait };
    if (want.event !== got.event) return { stepIndex: i, field: 'event', expected: want.event, actual: got.event };
    if (!sameValue(want.states, got.states)) return { stepIndex: i, field: 'states', expected: want.states, actual: got.states };
    if (!sameValue(want.effects.map(withoutTrailingNulls), got.effects.map(withoutTrailingNulls))) return { stepIndex: i, field: 'effects', expected: want.effects, actual: got.effects };
    const wantEmits = emitsValue(want.emits);
    const gotEmits = emitsValue(got.emits);
    if (!sameValue(wantEmits, gotEmits)) return { stepIndex: i, field: 'emits', expected: wantEmits, actual: gotEmits };
  }
  if (expected.steps.length !== actual.steps.length) {
    return { stepIndex: shared, field: 'length', expected: expected.steps.length, actual: actual.steps.length };
  }
  return null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** A wall-clock reading: a number (epoch time) or an ISO-8601 instant. */
function isClockReading(value: JsonValue): boolean {
  return typeof value === 'number' || (typeof value === 'string' && ISO_INSTANT.test(value));
}

const MINTED_ID_MARKER = '<minted-id>';

/** Replaces the string at `path` (a key, or `*` for every element of an array); other values are untouched. */
function maskStringAt(value: JsonValue, path: readonly string[]): JsonValue {
  const [head, ...rest] = path;
  if (head === undefined) return typeof value === 'string' ? MINTED_ID_MARKER : value;
  if (head === '*') return Array.isArray(value) ? value.map((element) => maskStringAt(element, rest)) : value;
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !(head in value)) return value;
  return { ...value, [head]: maskStringAt(value[head], rest) };
}

/**
 * Ids a store mints (a `persist create` that names none) compare as "a minted id", never by value: EXEC-PERSIST says the
 * store mints one that never collides and nothing about its format, and every store has its own (`ReviewEvent-1`, `id-0`,
 * a UUID). A declared field is `Event.path`, as for clock fields.
 */
export function applyMintedIds(trace: Trace, mintedIdFields: readonly string[]): Trace {
  return {
    steps: trace.steps.map((step): TraceStep => ({
      ...step,
      emits: step.emits.map((emit) => {
        const paths = mintedIdFields.filter((f) => f.startsWith(`${emit.event}.`)).map((f) => f.slice(emit.event.length + 1).split('.'));
        const payload = emit.payload;
        if (paths.length === 0 || payload === null || typeof payload !== 'object' || Array.isArray(payload)) return emit;
        return { event: emit.event, payload: paths.reduce<JsonValue>((masked, path) => maskStringAt(masked, path), payload) };
      }),
    })),
  };
}

/** Replaces the clock reading at `path` (a key, or `*` for every element of an array); other values are untouched. */
function maskAt(value: JsonValue, path: readonly string[]): JsonValue {
  const [head, ...rest] = path;
  if (head === undefined) return isClockReading(value) ? CLOCK_MARKER : value;
  if (head === '*') return Array.isArray(value) ? value.map((element) => maskAt(element, rest)) : value;
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !(head in value)) return value;
  return { ...value, [head]: maskAt(value[head], rest) };
}

/**
 * Wall-clock payload fields compare as "a clock reading", never by value. A declared field is
 * `Event.path`, where the path is dotted keys and `*` steps through an array (`Loaded.data.*.createdAt`).
 */
export function applyClockFields(trace: Trace, clockFields: readonly string[]): Trace {
  return {
    steps: trace.steps.map((step): TraceStep => ({
      ...step,
      emits: step.emits.map((emit) => {
        const paths = clockFields.filter((f) => f.startsWith(`${emit.event}.`)).map((f) => f.slice(emit.event.length + 1).split('.'));
        const payload = emit.payload;
        if (paths.length === 0 || payload === null || typeof payload !== 'object' || Array.isArray(payload)) return emit;
        return { event: emit.event, payload: paths.reduce<JsonValue>((masked, path) => maskAt(masked, path), payload) };
      }),
    })),
  };
}

/** A step against its `expect`; a declared clock field reads as the `<clock>` marker on the step, so an expectation writes it that way. */
export function unmetExpectations(dispatched: TraceStep, expectation: StepExpectation | undefined, clockFields: readonly string[] = []): string[] {
  if (expectation === undefined) return [];
  const [step] = applyClockFields({ steps: [dispatched] }, clockFields).steps;
  const misses = Object.entries(expectation.states ?? {})
    .filter(([trait, state]) => step.states[trait] !== state)
    .map(([trait, state]) => `${trait}=${step.states[trait]} (want ${state})`);
  if (expectation.emits !== undefined && !sameValue(emitsValue(step.emits), emitsValue(expectation.emits))) {
    misses.push(`emits ${JSON.stringify(canonical(emitsValue(step.emits)))} (want ${JSON.stringify(canonical(emitsValue(expectation.emits)))})`);
  }
  return misses;
}
