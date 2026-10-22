import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type * as Wire from '../src/generated/kernel-wire.js';
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
  OrbitalEventRequest,
  OrbitalEventResponse,
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
  responseKeys: Expect<SameKeys<Wire.EventResponse, OrbitalEventResponse>, true>;
  clientEffectByTrait: Expect<Mutual<Wire.ClientEffectByTrait, ClientEffectByTrait>, true>;
  request: Expect<Mutual<Wire.EventRequest, OrbitalEventRequest>, true>;
  response: Expect<Mutual<Wire.EventResponse, OrbitalEventResponse>, true>;
  rowSetRef: Expect<Mutual<Wire.RowSetRef, RowSetRef>, true>;
  rowQuery: Expect<Mutual<Wire.RowQuery, RowQuery>, true>;
  queryCapabilities: Expect<Mutual<Wire.QueryCapabilities, QueryCapabilities>, true>;
  writeCapabilities: Expect<Mutual<Wire.WriteCapabilities, WriteCapabilities>, true>;
  rowWriteOp: Expect<Mutual<Wire.RowWriteOp, RowWriteOp>, true>;
  rowWriteOutcome: Expect<Mutual<Wire.RowWriteOutcome, RowWriteOutcome>, true>;
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
