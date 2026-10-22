/**
 * Declared external inputs — the events a client outside the program (an API
 * caller, an agent acting as the user, an MCP client) may send a trait. Authored
 * as `listens { EVENT -> external { … } }`, lowered onto the trait's own
 * `stateMachine.events[]` entry as `external: true`. The one owner of that list:
 * hosts gate their input channel with it, and clients build their tool lists
 * from it. Mirrors `orbital-core/src/runtime/external_inputs.rs`.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from '../types/schema.js';
import type { PayloadField } from '../types/state-machine.js';
import type { JsonSchema } from '../factory/types.js';
import type { EventPayload, EventPayloadValue } from '../types/expression.js';
import { mapEntityFieldType } from '../factory/params-schema.js';
import { isInlineTrait, splitEventAddress } from '../types/trait.js';
import { orbitalInlineEntities } from './entityAccess.js';

/**
 * An event written with `listens` addressing (`EVENT`, `Trait.EVENT`,
 * `Orbital.Trait.EVENT`) as a value. A service contract param of this type is
 * checked by `orb validate` against the program's declared external inputs.
 */
export type EventAddress = string;

export interface ExternalInput {
  orbital: string;
  trait: string;
  event: string;
  payloadSchema: PayloadField[];
  description?: string;
  synonyms?: string;
  tier?: string;
}

export function externalInputsOf(schema: OrbitalSchema): ExternalInput[] {
  const out: ExternalInput[] = [];
  for (const orbital of schema.orbitals ?? []) {
    for (const traitRef of orbital.traits ?? []) {
      if (!isInlineTrait(traitRef)) continue;
      for (const ev of traitRef.stateMachine?.events ?? []) {
        if (ev.external !== true) continue;
        out.push({
          orbital: orbital.name,
          trait: traitRef.name,
          event: ev.key,
          payloadSchema: ev.payloadSchema ?? [],
          ...(ev.description !== undefined ? { description: ev.description } : {}),
          ...(ev.synonyms !== undefined ? { synonyms: ev.synonyms } : {}),
          ...(ev.tier !== undefined ? { tier: ev.tier } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * The entities a `call-service` provider acting as the caller may read: every
 * persisted entity, once, in schema order. Rows stay filtered by each entity's
 * `@read` policy at read time. Mirrors the compiled host's `ENTITY_READS`
 * (`orbital-shell-typescript` `orbital_route.rs`).
 */
export function readableEntitiesOf(schema: OrbitalSchema): string[] {
  const out: string[] = [];
  for (const orbital of schema.orbitals ?? []) {
    for (const entity of orbitalInlineEntities(orbital)) {
      if (entity.persistence === 'runtime' || out.includes(entity.name)) continue;
      out.push(entity.name);
    }
  }
  return out;
}

export function findExternalInput(
  schema: OrbitalSchema,
  orbital: string,
  trait: string,
  event: string,
): ExternalInput | undefined {
  return externalInputsOf(schema).find((i) => i.orbital === orbital && i.trait === trait && i.event === event);
}

/**
 * The declared input a `listens`-addressed event names, resolved from the
 * calling trait's position: `EVENT` is that trait's own, `Trait.EVENT` a trait
 * of its orbital, `Orbital.Trait.EVENT` any orbital. Mirrors the L2 rule in
 * `orbital-compiler` `config_type.rs` `EventRefIndex::check`.
 */
export function findInputByAddress(
  inputs: readonly ExternalInput[],
  address: string,
  caller: { orbital: string; trait: string },
): ExternalInput | undefined {
  const { event, source } = splitEventAddress(address);
  if (source?.kind === 'any') return undefined;
  const orbital = source?.kind === 'orbital' ? source.orbital : caller.orbital;
  const trait = source === undefined ? caller.trait : source.trait;
  return inputs.find((i) => i.orbital === orbital && i.trait === trait && i.event === event);
}

/** A declared payload as the JSON Schema of one object — what a tool-calling model fills. */
export function payloadSchemaToJsonSchema(fields: readonly PayloadField[]): JsonSchema {
  const properties: { [key: string]: JsonSchema } = {};
  const required: string[] = [];
  for (const field of fields) {
    // An object that declares no keys can take no argument, so it is not offered.
    if (field.properties !== undefined && field.properties.length === 0 && field.type !== 'union') continue;
    properties[field.name] = payloadFieldToJsonSchema(field);
    if (field.required === true) required.push(field.name);
  }
  return {
    type: 'object',
    ...(fields.length > 0 ? { additionalProperties: false } : {}),
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function elementOf(type: string): { isArray: boolean; element: string } {
  const isArray = type.startsWith('[') && type.endsWith(']');
  return { isArray, element: isArray ? type.slice(1, -1) : type };
}

function payloadFieldToJsonSchema(field: PayloadField): JsonSchema {
  const { isArray, element } = elementOf(field.type);
  const base: JsonSchema =
    field.properties !== undefined
      ? payloadSchemaToJsonSchema(field.properties)
      : (() => {
          const t = mapEntityFieldType(element);
          return t === null ? {} : { type: t };
        })();
  const shape: JsonSchema = field.values !== undefined ? { ...base, enum: [...field.values] } : base;
  return isArray ? { type: 'array', items: shape } : shape;
}

function isPayloadObject(value: EventPayloadValue): value is EventPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** One way a value misses its declared payload. */
export interface PayloadIssue {
  readonly path: string;
  readonly reason: 'missing' | 'unknown' | 'wrong-type' | 'not-one-of';
  readonly expected?: string;
}

/**
 * Check a value against a declared payload: required fields, primitive and container types,
 * closed value sets, declared object shapes (closed) at any depth. An object field without
 * declared properties stays open; a type with no JSON shape (`node`, an entity name) is not
 * checked beyond its container.
 */
export function payloadIssues(fields: readonly PayloadField[], value: EventPayloadValue): PayloadIssue[] {
  return objectIssues(fields, value, '');
}

function objectIssues(fields: readonly PayloadField[], value: EventPayloadValue, at: string): PayloadIssue[] {
  if (!isPayloadObject(value)) {
    return [{ path: at === '' ? '.' : at, reason: 'wrong-type', expected: 'object' }];
  }
  const join = (key: string): string => (at === '' ? key : `${at}.${key}`);
  const issues: PayloadIssue[] = [];
  for (const field of fields) {
    const v = value[field.name];
    if (v === undefined || v === null) {
      if (field.required === true) issues.push({ path: join(field.name), reason: 'missing' });
      continue;
    }
    issues.push(...fieldIssues(field, v, join(field.name)));
  }
  const declared = new Set(fields.map((f) => f.name));
  const allowed = fields.length > 0 ? fields.map((f) => f.name).join(' | ') : '(no keys)';
  for (const key of Object.keys(value)) {
    if (!declared.has(key)) issues.push({ path: join(key), reason: 'unknown', expected: allowed });
  }
  return issues;
}

function fieldIssues(field: PayloadField, value: EventPayloadValue, at: string): PayloadIssue[] {
  const { isArray, element } = elementOf(field.type);
  if (isArray || field.type === 'array') {
    if (!Array.isArray(value)) return [{ path: at, reason: 'wrong-type', expected: field.type }];
    return value.flatMap((item, i) => elementIssues(field, element, item, `${at}[${i}]`));
  }
  return elementIssues(field, element, value, at);
}

function elementIssues(field: PayloadField, element: string, value: EventPayloadValue, at: string): PayloadIssue[] {
  if (field.properties !== undefined && field.type !== 'union') return objectIssues(field.properties, value, at);
  if (field.type === 'union' && field.properties !== undefined) {
    const variants = field.properties;
    return variants.some((v) => elementIssues(v, elementOf(v.type).element, value, at).length === 0)
      ? []
      : [{ path: at, reason: 'wrong-type', expected: variants.map((v) => v.type).join(' | ') }];
  }
  const json = element === 'object' ? 'object' : mapEntityFieldType(element);
  const matches =
    json === null ||
    (json === 'object' && isPayloadObject(value)) ||
    (json === 'array' && Array.isArray(value)) ||
    (json === 'string' && (typeof value === 'string' || value instanceof Date)) ||
    (json === 'number' && typeof value === 'number') ||
    (json === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
    (json === 'boolean' && typeof value === 'boolean');
  if (!matches) return [{ path: at, reason: 'wrong-type', expected: element }];
  if (field.values !== undefined && (typeof value !== 'string' || !field.values.includes(value))) {
    return [{ path: at, reason: 'not-one-of', expected: field.values.join(' | ') }];
  }
  return [];
}
