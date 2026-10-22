/**
 * Server-side effect result — the wire shape a server-executed effect
 * (`SERVER_REPORTED_EFFECTS` in `effect.ts`) reports back to the client,
 * closing the circuit on `OrbitalEventResponse.effectResults`.
 *
 * Promoted from `@almadar/runtime`'s `ServerEffectHandlers.ts` (the JS
 * interpreter's own definition, canonical per `CLAUDE.md`'s "converge on
 * the TypeScript implementation" ruling) so `@almadar/core` owns the one
 * shape both execution paths report against.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { EntityRowSchema, type EntityRow } from './entity.js';
import { SERVER_REPORTED_EFFECTS, type ServerReportedEffect, type NamespacedEffectName } from './effect.js';
import { EventPayloadValueSchema, type EventPayloadValue } from './expression.js';

/**
 * Result entry recorded for each effect invocation. Mirrors the server
 * runtime's `EffectResult`. Callers who want telemetry pass an array that
 * the factory appends to; otherwise it's unused.
 */
export interface ServerBatchSummary {
  operations: EntityRow[];
  completedCount: number;
  totalCount: number;
}

/** Zod twin of `ServerBatchSummary`. */
export const ServerBatchSummarySchema: z.ZodType<ServerBatchSummary> = z.object({
  operations: z.array(EntityRowSchema),
  completedCount: z.number(),
  totalCount: z.number(),
});

export interface ServerEffectResult {
  /**
   * The reported effect's head (`SERVER_REPORTED_EFFECTS`, derived from the
   * effect union in `effect.ts`), or `"substrate"` — the one wire grouping
   * for the namespaced operators (`trace/*`, `memory/*`, `session/*`,
   * `behavior/*`, `compose/*`), whose head rides `name`.
   */
  effect: ServerReportedEffect | "substrate";
  action?: string;
  entityType?: string;
  /** The invoked namespaced operator (e.g. `"memory/store"`), set only on `effect: "substrate"`. */
  name?: NamespacedEffectName;
  /** Entity row for CRUD/set/swap, the batch summary for `persist batch`, the raw service/substrate result. */
  data?: EntityRow | ServerBatchSummary | EventPayloadValue;
  success: boolean;
  /**
   * Set when a persist failed because an access policy rejected it or the
   * write resolved no row key — mirrors `OrbitalServerRuntime.EffectResult`
   * so the offline-preview and real-server persist paths report the same
   * denial discriminator to the verification trace.
   */
  denied?: true;
  error?: string;
  /** Coded failure reason for a persist that resolved no target row (`not-found`, `no-row-key`), created on a taken id (`duplicate-id`), or was refused by a declared policy (`denied`, EXEC-STEP-8). */
  code?: "not-found" | "no-row-key" | "duplicate-id" | "denied";
  /** What the effect addressed: an `http` effect's `<METHOD> <origin><path>`, an `emit` entry's event name. */
  target?: string;
  /** The declared `emit.failure` event the program routed this effect's failure to; absent when it declares none. */
  routed?: string;
}

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
  code: z.enum(["not-found", "no-row-key", "duplicate-id", "denied"]).optional(),
  target: z.string().optional(),
  routed: z.string().optional(),
});
