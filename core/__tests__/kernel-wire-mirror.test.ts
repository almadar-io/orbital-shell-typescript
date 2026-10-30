import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as Wire from '../src/generated/kernel-wire.js';
import type { JsonObject, JsonValue } from '../src/types/json.js';
import type {
  AwaitingTrait,
  BusEventSource,
  ClientEffectByTrait,
  ClientEffectTuple,
  DeliveryRecord,
  DispatchLog,
  DispatchMode,
  EmittedEvent,
  MountSeed,
  QueryCapabilities,
  RowQuery,
  RowSetRef,
  RowWriteOp,
  RowWriteOutcome,
  WriteCapabilities,
  ServerEffectResult,
  TransitionRejection,
  TransitionRejectionCode,
  TransitionHop,
} from '../src/types/index.js';

/**
 * `src/generated/kernel-wire.ts` is generated from the Rust embed wire (`orbital-core`
 * `embed::wire`). Each generated type is compared with the `@almadar/core` type it mirrors, which
 * is the contract:
 *  - `Mutual<G, C>` holds when each is assignable to the other;
 *  - `SameKeys<G, C>` holds when both declare exactly the same property names (assignability alone
 *    lets a side silently omit an optional property the other declares).
 * A pair recorded as `false` is a known disagreement. It is asserted as `false`, so the test stops
 * compiling the moment the Rust side or core closes it and the entry must be flipped to `true`.
 */
type Mutual<G, C> = [G] extends [C] ? ([C] extends [G] ? true : false) : false;
type SameKeys<G, C> = [keyof G] extends [keyof C] ? ([keyof C] extends [keyof G] ? true : false) : false;
type Expect<Actual extends Expected, Expected> = Actual;

interface Mirror {
  // identical on both sides
  dispatchMode: Expect<Mutual<Wire.DispatchMode, DispatchMode>, true>;
  awaitingTrait: Expect<Mutual<Wire.AwaitingTrait, AwaitingTrait>, true>;
  awaitingTraitKeys: Expect<SameKeys<Wire.AwaitingTrait, AwaitingTrait>, true>;
  rejectionCode: Expect<Mutual<Wire.TransitionRejectionCode, TransitionRejectionCode>, true>;
  rejection: Expect<Mutual<Wire.TransitionRejection, TransitionRejection>, true>;
  rejectionKeys: Expect<SameKeys<Wire.TransitionRejection, TransitionRejection>, true>;
  emitted: Expect<Mutual<Wire.EmittedEvent, EmittedEvent>, true>;
  emittedKeys: Expect<SameKeys<Wire.EmittedEvent, EmittedEvent>, true>;
  delivery: Expect<Mutual<Wire.DeliveryRecord, DeliveryRecord>, true>;
  deliveryKeys: Expect<SameKeys<Wire.DeliveryRecord, DeliveryRecord>, true>;
  dispatchLog: Expect<Mutual<Wire.DispatchLog, DispatchLog>, true>;
  dispatchLogKeys: Expect<SameKeys<Wire.DispatchLog, DispatchLog>, true>;
  busEventSource: Expect<Mutual<Wire.BusEventSource, BusEventSource>, true>;

  busEventSourceKeys: Expect<SameKeys<Wire.BusEventSource, BusEventSource>, true>;
  mountSeed: Expect<Mutual<Wire.MountSeed, MountSeed>, true>;
  transitionTrace: Expect<Mutual<Wire.TransitionHop, TransitionHop>, true>;
  transitionTraceKeys: Expect<SameKeys<Wire.TransitionHop, TransitionHop>, true>;
  clientEffect: Expect<Mutual<Wire.ClientEffect, ClientEffectTuple>, true>;
  serverEffectResult: Expect<Mutual<Wire.ServerEffectResult, ServerEffectResult>, true>;
  serverEffectResultKeys: Expect<SameKeys<Wire.ServerEffectResult, ServerEffectResult>, true>;
  clientEffectByTrait: Expect<Mutual<Wire.ClientEffectByTrait, ClientEffectByTrait>, true>;
  rowSetRef: Expect<Mutual<Wire.RowSetRef, RowSetRef>, true>;
  rowQuery: Expect<Mutual<Wire.RowQuery, RowQuery>, true>;
  queryCapabilities: Expect<Mutual<Wire.QueryCapabilities, QueryCapabilities>, true>;
  writeCapabilities: Expect<Mutual<Wire.WriteCapabilities, WriteCapabilities>, true>;
  writeCapabilitiesKeys: Expect<SameKeys<Wire.WriteCapabilities, WriteCapabilities>, true>;
  rowWriteOp: Expect<Mutual<Wire.RowWriteOp, RowWriteOp>, true>;
  rekeyKeys: Expect<SameKeys<Extract<Wire.RowWriteOp, { kind: 'rekey' }>, Extract<RowWriteOp, { kind: 'rekey' }>>, true>;
  rowWriteOutcome: Expect<Mutual<Wire.RowWriteOutcome, RowWriteOutcome>, true>;
  // the wire is JSON: a request, a response and everything a stream carries is a `JsonValue` as it stands
    emittedIsJson: Expect<EmittedEvent, JsonValue>;
  clientEffectIsJson: Expect<ClientEffectTuple, JsonValue>;
  generatedResponseIsJson: Expect<Wire.EventResponse, JsonValue>;
  generatedRequestIsJson: Expect<Wire.EventRequest, JsonValue>;
  entityRowIsJson: Expect<Wire.EntityRow, JsonValue>;
}

describe('kernel wire mirror', () => {
  it('declares every wire type it compares (the pairs themselves are checked by `tsc`)', () => {
    const generated = readFileSync(fileURLToPath(new URL('../src/generated/kernel-wire.ts', import.meta.url)), 'utf8');
    const names = ['DispatchMode', 'AwaitingTrait', 'TransitionRejectionCode', 'TransitionRejection', 'EmittedEvent', 'DeliveryRecord', 'DispatchLog', 'BusEventSource', 'MountSeed', 'TransitionHop', 'HopEffect', 'CallSiteWire', 'CallRoutesWire', 'ClientEffect', 'ServerEffectResult', 'ClientEffectByTrait', 'EventRequest', 'EventResponse'];
    for (const name of names) expect(generated).toContain(`export type ${name} = `);
  });

  it('control: a shape that differs from the core type is not mutual and has different keys', () => {
    type Wrong = { trait: string; event: string };
    const notMutual: Expect<Mutual<Wrong, AwaitingTrait>, false> = false;
    const notSameKeys: Expect<SameKeys<Wrong, AwaitingTrait>, false> = false;
    expect([notMutual, notSameKeys]).toEqual([false, false]);
  });
});

interface ScriptStep {
  op: string;
}

interface Script {
  steps: ScriptStep[];
}

const fixtures = new URL('../fixtures/kernel-wire/', import.meta.url);
const guards: Record<string, (value: JsonValue) => boolean> = {
  dispatch: Wire.isDispatchWire,
  apply: Wire.isAppliedWire,
  snapshot: Wire.isSnapshotWire,
  tick: Wire.isEventResponse,
  restore: Wire.isEventResponse,
  frame: Wire.isFrameWire,
};

function recorded(): Array<{ name: string; op: string; output: JsonValue }> {
  const out: Array<{ name: string; op: string; output: JsonValue }> = [];
  for (const file of readdirSync(new URL('scripts/', fixtures)).sort()) {
    const script: Script = JSON.parse(readFileSync(new URL(`scripts/${file}`, fixtures), 'utf8'));
    const golden: JsonValue[] = JSON.parse(readFileSync(new URL(`golden/${file}`, fixtures), 'utf8'));
    script.steps.forEach((step, at) => {
      const output = golden[at];
      const failed = typeof output === 'object' && output !== null && !Array.isArray(output) && 'error' in output;
      if (output !== null && output !== undefined && !failed && step.op in guards) out.push({ name: file, op: step.op, output });
    });
  }
  return out;
}

describe('kernel wire guards, over the outputs the kernel recorded', () => {
  it('accepts every recorded dispatch, apply, snapshot, tick, restore and frame output', () => {
    const outputs = recorded();
    expect(new Set(outputs.map((entry) => entry.op))).toEqual(new Set(Object.keys(guards)));
    for (const { name, op, output } of outputs) {
      expect(guards[op]!(output), `${name} ${op}`).toBe(true);
    }
  });

  it('control: refuses a dispatch missing a required field, a frame with a malformed dispatch, and a non-object', () => {
    const object = (value: JsonValue | undefined): JsonObject => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('fixture: not an object');
      return value;
    };
    const without = (value: JsonValue | undefined, key: string): JsonObject => {
      const { [key]: _dropped, ...rest } = object(value);
      return rest;
    };
    const outputs = recorded();
    const dispatch = outputs.find((entry) => entry.op === 'dispatch')?.output;
    const frame = outputs
      .filter((entry) => entry.op === 'frame')
      .map((entry) => object(entry.output))
      .find((entry) => Array.isArray(entry['dispatches']) && entry['dispatches'].length > 0);
    expect(dispatch).toBeDefined();
    expect(frame).toBeDefined();
    expect(Wire.isDispatchWire(without(dispatch, 'snapshot'))).toBe(false);
    expect(Wire.isDispatchWire(without(dispatch, 'statefulLeg'))).toBe(false);
    const first = Array.isArray(frame?.['dispatches']) ? frame['dispatches'][0] : undefined;
    expect(Wire.isFrameWire({ ...object(frame), dispatches: [without(first, 'statefulLeg')] })).toBe(false);
    expect(Wire.isFrameWire('frame')).toBe(false);
    expect(Wire.isSnapshotWire([])).toBe(false);
  });
});
