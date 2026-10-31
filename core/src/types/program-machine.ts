/**
 * Zod twins of the program reflection records the kernel answers with: a program's state machine as rows
 * (`program/machine` → `MachineRow[]`) and a played request (`program/step` → `PlayedStep[]`). The types are
 * generated from `orbital-core` `program_machine`; these schemas are what `program-types.ts` projects so a `.lolo`
 * program can read them member by member.
 */
import { z } from 'zod';

import type {
  EntityBinding,
  EntityBindingKind,
  EnsuresVerdict,
  EvalStepWire,
  GuardVerdict,
  MachineRow,
  PayloadSlot,
  PendingAsk,
  PlayedEffect,
  PlayedEffectStatus,
  PlayedEmit,
  PlayedEnsures,
  PlayedGuard,
  PlayedOutcome,
  PlayedResult,
  PlayedState,
  PlayedStep,
  PropositionBindings,
  RenderedNode,
  RenderedSlot,
  TraitRef,
} from '../generated/kernel-wire.js';
import { EventPayloadSchema } from './expression.js';
import { JsonValueSchema } from './json.js';

export type {
  EntityBinding,
  EntityBindingKind,
  EnsuresVerdict,
  GuardVerdict,
  MachineRow,
  PayloadSlot,
  PendingAsk,
  PlayedEffect,
  PlayedEffectStatus,
  PlayedEmit,
  PlayedEnsures,
  PlayedGuard,
  PlayedOutcome,
  PlayedResult,
  PlayedState,
  PlayedStep,
  PropositionBindings,
  RenderedNode,
  RenderedSlot,
  TraitRef,
};

export const PayloadSlotSchema: z.ZodType<PayloadSlot> = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  values: z.array(z.string()).optional(),
  entity: z.string().optional(),
});

export const MachineRowSchema: z.ZodType<MachineRow> = z.object({
  orbital: z.string(),
  trait: z.string(),
  from: z.string(),
  event: z.string(),
  to: z.string(),
  guarded: z.boolean(),
  payload: z.array(PayloadSlotSchema),
});

/** Where a traced evaluation step sits in its expression: indexes and keys, outermost first. */
export const EvalPathSchema = z.array(z.union([z.number(), z.string()]));

const EvalStepWireSchema: z.ZodType<EvalStepWire> = z.object({
  kind: z.enum(['enter', 'exit', 'iter', 'skip']),
  path: EvalPathSchema,
  value: JsonValueSchema.optional(),
  error: z.string().optional(),
});

const PlayedEffectSchema: z.ZodType<PlayedEffect> = z.object({
  type: z.string(),
  args: z.array(JsonValueSchema),
  status: z.enum(['executed', 'failed', 'skipped']),
  error: z.string().optional(),
  routed: z.boolean(),
});

const PropositionBindingsSchema: z.ZodType<PropositionBindings> = z.object({
  entity: JsonValueSchema,
  fromEntity: JsonValueSchema,
  payload: JsonValueSchema,
});

const PlayedEnsuresSchema: z.ZodType<PlayedEnsures> = z.object({
  proposition: JsonValueSchema,
  verdict: z.enum(['held', 'broken', 'inconclusive']),
  reason: z.string().optional(),
  counterexample: PropositionBindingsSchema.optional(),
});

const PlayedEmitSchema: z.ZodType<PlayedEmit> = z.object({
  type: z.string(),
  payload: EventPayloadSchema.optional(),
  timestamp: z.number(),
});

const PlayedGuardSchema: z.ZodType<PlayedGuard> = z.object({
  arm: z.number(),
  guard: JsonValueSchema,
  passed: z.boolean(),
  trace: z.array(EvalStepWireSchema),
  error: z.string().optional(),
});

const EntityBindingSchema: z.ZodType<EntityBinding> = z.object({
  kind: z.enum(['none', 'absent', 'malformed', 'inline', 'named', 'payload-unresolved', 'context-unresolved']),
  entity: z.string(),
  rows: z.number(),
  readGated: z.boolean(),
});

const TraitRefSchema: z.ZodType<TraitRef> = z.object({
  name: z.string(),
  resolved: z.boolean(),
  overlayOnly: z.boolean(),
});

const RenderedNodeSchema: z.ZodType<RenderedNode> = z.object({
  pattern: z.string(),
  dynamic: z.boolean(),
  supported: z.boolean(),
  stub: z.boolean(),
  binding: EntityBindingSchema,
  traitRefs: z.array(TraitRefSchema),
});

const RenderedSlotSchema: z.ZodType<RenderedSlot> = z.object({
  slot: z.string(),
  sourceTrait: z.string(),
  ownerEntity: z.string(),
  nodes: z.array(RenderedNodeSchema),
  props: JsonValueSchema.optional(),
  fault: z.object({ code: z.enum(['no-matching-transition', 'guard-rejected', 'no-dispatchable-traits', 'not-an-external-input', 'inbound-only-event', 'effect-failed', 'locale-not-declared', 'client-circuit-state-refused', 'repaint-failed']), error: z.string() }).optional(),
});

const PlayedStateSchema: z.ZodType<PlayedState> = z.object({ before: z.string().nullable(), after: z.string().nullable() });

const PendingAskSchema: z.ZodType<PendingAsk> = z.object({
  trait: z.string(),
  operator: z.string(),
  args: z.array(JsonValueSchema),
  key: z.string(),
});

const PlayedOutcomeSchema: z.ZodType<PlayedOutcome> = z.object({
  orbital: z.string(),
  trait: z.string(),
  event: z.string(),
  from: z.string(),
  to: z.string(),
  arm: z.number().optional(),
  fired: z.boolean(),
  effects: z.array(PlayedEffectSchema),
  emitted: z.array(PlayedEmitSchema),
});

const JsonRecordSchema = z.record(z.string(), JsonValueSchema);

const PlayedResultSchema: z.ZodType<PlayedResult> = z.object({
  trait: z.string(),
  event: z.string(),
  transitionFired: z.boolean(),
  guard: z.enum(['pass', 'fail', 'none']),
  firedArm: z.number().optional(),
  state: PlayedStateSchema,
  effects: z.array(PlayedEffectSchema),
  emitted: z.array(PlayedEmitSchema),
  guards: z.array(PlayedGuardSchema),
  ensures: z.array(PlayedEnsuresSchema),
  rendered: z.array(RenderedSlotSchema).optional(),
  failure: z.string().optional(),
  entityAfter: EventPayloadSchema.nullable(),
  pendingAsks: z.array(PendingAskSchema),
  outcomes: z.array(PlayedOutcomeSchema),
});

export const PlayedStepSchema: z.ZodType<PlayedStep> = z.object({
  orbital: z.string(),
  trait: z.string(),
  from: z.string(),
  event: z.string(),
  payload: EventPayloadSchema,
  result: PlayedResultSchema,
  entity: JsonRecordSchema.optional(),
  config: JsonRecordSchema.optional(),
  now: z.number().optional(),
  settleMs: z.number().optional(),
  viewer: JsonRecordSchema.nullable().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
});
