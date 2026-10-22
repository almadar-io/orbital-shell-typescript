/**
 * JSON primitives — the universal "data crossed a boundary" type.
 *
 * Every value that arrives over the wire from an LLM (tool-call args),
 * from disk (workspace files), or from an HTTP body before
 * domain-specific validation is a `JsonValue`. Narrow with a typed
 * predicate (`is`-guard) at the boundary; don't widen back to `unknown`.
 *
 * `JsonObject` and `ToolArgs` are aliases for the common
 * `Record<string, JsonValue>` shape. `ToolArgs` is the name the
 * agent surface uses for LLM-emitted tool-call arguments; `JsonObject`
 * is the general-purpose alias. They are the same type — the alias
 * exists so call sites read at the right semantic level.
 *
 * Why not `Record<string, unknown>`? Two reasons. (1) `unknown` widens
 * back to anything, which defeats the purpose of typing the boundary.
 * (2) The `@almadar/eslint-plugin/no-record-string-unknown` rule blocks
 * the wider form — `JsonValue`-based records are the typed answer.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { EventPayloadValue } from './expression.js';

/**
 * Recursive JSON value union — every shape JSON can carry.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSON object — keyed string→JsonValue. The wire form of arbitrary
 * structured data. Replaces `Record<string, unknown>` at typed
 * boundaries (LLM emits, file reads, HTTP bodies).
 */
export type JsonObject = { [key: string]: JsonValue };

/** Zod schema for JsonValue — the one boundary validator for parsed-JSON slots. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]),
);

/**
 * LLM tool-call arguments — same shape as `JsonObject`, named for the
 * agent-surface call site. Each tool's `execute(args: ToolArgs)`
 * receives this and narrows via an `is`-guard predicate before any
 * field access.
 */
export type ToolArgs = JsonObject;

/**
 * Universal type-guard input — every runtime value shape a predicate can
 * be handed, enumerated instead of `unknown` (the repo bans `unknown`
 * even at guard boundaries). Primitives cover every `typeof` result;
 * `object` covers arrays, records, class instances, and functions.
 */
export type RuntimeValue =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | Date
  | null
  | undefined
  | object;

/**
 * Type guard: is the given value a JSON primitive (non-array,
 * non-object)? Used by walkers that decide whether to recurse.
 */
export function isJsonPrimitive(
  value: JsonValue,
): value is string | number | boolean | null {
  return (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  );
}

/**
 * Type guard: is the given value a JSON object (non-array, non-null)?
 */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
  );
}

/**
 * Type guard: is the given value a JSON array?
 */
export function isJsonArray(value: JsonValue): value is JsonValue[] {
  return Array.isArray(value);
}

/**
 * A rich value the UI hands back (a program schema, a selected node) as an event payload value:
 * its JSON form, which is what the event wire carries. `JsonValue` is a payload value.
 */
export function toPayloadValue(value: object | null | undefined): EventPayloadValue {
  if (value === null || value === undefined) return value;
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}
