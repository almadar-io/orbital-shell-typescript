/**
 * Server-side effect result — the wire shape a server-executed effect
 * (`SERVER_REPORTED_EFFECTS` in `effect.ts`) reports back to the client,
 * closing the circuit on `EventResponse.effectResults`.
 *
 * Promoted from `@almadar/runtime`'s `ServerEffectHandlers.ts` (the JS
 * interpreter's own definition, canonical per `CLAUDE.md`'s "converge on
 * the TypeScript implementation" ruling) so `@almadar/core` owns the one
 * shape both execution paths report against.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { ServerEffectResult } from '../generated/kernel-wire.js';
import { EntityRowSchema, type EntityRow } from './entity.js';
import { SERVER_REPORTED_EFFECTS, type ServerReportedEffect, type NamespacedEffectName } from './effect.js';
import { EventPayloadValueSchema, type EventPayloadValue } from './expression.js';

/**
 * Result entry recorded for each effect invocation. Mirrors the server
 * runtime's `EffectResult`. Callers who want telemetry pass an array that
 * the factory appends to; otherwise it's unused.
 */
export type ServerBatchSummary = {
  operations: EntityRow[];
  completedCount: number;
  totalCount: number;
};

/** Zod twin of `ServerBatchSummary`. */
export const ServerEffectCodeSchema = z.enum(["not-found", "no-row-key", "duplicate-id", "denied", "derived-failed"]);

export const ServerBatchSummarySchema: z.ZodType<ServerBatchSummary> = z.object({
  operations: z.array(EntityRowSchema),
  completedCount: z.number(),
  totalCount: z.number(),
});

/** The wire shape a server-executed effect reports on `EventResponse.effectResults`: the generated kernel wire type, one copy. */
export type { ServerEffectResult };

/** Zod twin of `ServerEffectResult`. */
export const ServerEffectResultSchema: z.ZodType<ServerEffectResult> = z.object({
  effect: z.union([z.enum(SERVER_REPORTED_EFFECTS), z.literal("substrate")]),
  action: z.string().optional(),
  entityType: z.string().optional(),
  name: z.custom<NamespacedEffectName>((v) => typeof v === "string" && /^[^/]+\/.+$/.test(v)).optional(),
  data: z.union([EntityRowSchema, ServerBatchSummarySchema, EventPayloadValueSchema]).optional(),
  success: z.boolean(),
  denied: z.literal(true).optional(),
  error: z.string().optional(),
  code: ServerEffectCodeSchema.optional(),
  target: z.string().optional(),
  routed: z.string().optional(),
});
