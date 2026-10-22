/**
 * Expectation shape union — the JS composer's merge of two `expects` shapes field by field
 * (requiredness and value lists widen, ranges narrow, nested properties and items merge;
 * incompatible constraints throw). Twin of `orbital-core` `expects::merge_expectation_shape`,
 * which the derivation (now in `orb`) uses.
 *
 * @packageDocumentation
 */

import { canonicalJson } from './types/visit-key.js';
import type { EventPayloadValue } from './types/expression.js';
import { EntityFieldSchema, type EntityField } from './types/field.js';

export function mergeExpectationShape(existing: readonly EntityField[] | undefined, incoming: readonly EntityField[] | undefined): EntityField[] | undefined {
  if (existing === undefined && incoming === undefined) return undefined;
  const mergeField = (prior: EntityField, field: EntityField): EntityField => {
    const fail = (): never => { throw new Error(`expectation shape mismatch — field "${field.name ?? prior.name}" has incompatible type constraints`); };
    const priorType = prior.type === 'enum' ? 'string' : prior.type;
    const fieldType = field.type === 'enum' ? 'string' : field.type;
    if (priorType !== fieldType) return fail();
    if (prior.type === 'relation' && field.type === 'relation') {
      if (prior.relation.entityId !== undefined && field.relation.entityId !== undefined && prior.relation.entityId !== field.relation.entityId) return fail();
      const relation = (value: typeof prior.relation): EventPayloadValue => ({ entity: value.entity, cardinality: value.cardinality, field: value.field, onDelete: value.onDelete });
      if (canonicalJson(relation(prior.relation)) !== canonicalJson(relation(field.relation))) return fail();
    }
    if (prior.type === 'tuple' && field.type === 'tuple' && canonicalJson(Object.keys(prior.properties).sort()) !== canonicalJson(Object.keys(field.properties).sort())) return fail();
    const min = prior.min === undefined ? field.min : field.min === undefined ? prior.min : Math.max(prior.min, field.min);
    const max = prior.max === undefined ? field.max : field.max === undefined ? prior.max : Math.min(prior.max, field.max);
    if (min !== undefined && max !== undefined && min > max) return fail();
    let merged: EntityField = { ...prior, ...(prior.required === true || field.required === true ? { required: true } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    if (prior.type === 'relation' && field.type === 'relation') merged = { ...merged, type: 'relation', relation: { ...prior.relation, ...(prior.relation.entityId === undefined && field.relation.entityId !== undefined ? { entityId: field.relation.entityId } : {}) } };
    if ('values' in prior || 'values' in field) {
      const values = [...new Set([...('values' in prior ? prior.values ?? [] : []), ...('values' in field ? field.values ?? [] : [])])];
      if (values.length > 0) merged = EntityFieldSchema.parse({ ...merged, values });
    }
    if (prior.properties !== undefined || field.properties !== undefined) {
      const properties = { ...prior.properties };
      for (const [key, value] of Object.entries(field.properties ?? {})) properties[key] = properties[key] === undefined ? value : mergeField(properties[key], value);
      merged = { ...merged, properties };
    }
    if ('items' in prior || 'items' in field) {
      const priorItems = 'items' in prior ? prior.items : undefined;
      const incomingItems = 'items' in field ? field.items : undefined;
      const items = priorItems === undefined ? incomingItems : incomingItems === undefined ? priorItems : mergeField(priorItems, incomingItems);
      if (items !== undefined) merged = EntityFieldSchema.parse({ ...merged, items });
    }
    return merged;
  };
  const merged = [...(existing ?? [])];
  for (const field of incoming ?? []) {
    const index = merged.findIndex(candidate => candidate.name === field.name);
    const prior = merged[index];
    if (prior === undefined) merged.push(field);
    else merged[index] = mergeField(prior, field);
  }
  return merged;
}
