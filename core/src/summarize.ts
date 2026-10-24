/**
 * Orbital Summarization
 *
 * Deterministic orbital-to-orbital transformation:
 * full schema in → business skeleton out.
 *
 * Input: OrbitalSchema. Output: OrbitalSchema.
 * Same types — just stripped of implementation details.
 *
 * This module provides functions to extract the essential business structure
 * from a complete orbital schema, removing implementation details like
 * effects, guards, and visual styling while preserving the core entity,
 * trait, and page definitions.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from './types/schema.js';
import type { OrbitalDefinition } from './types/orbital.js';
import { isEntityCall, isEntityReference, parseEntityRef } from './types/orbital.js';
import type { Entity } from './types/entity.js';
import type { EntityField } from './types/field.js';
import { isTypeVariableField } from './types/field.js';
import type { Trait } from './types/trait.js';
import { isInlineTrait } from './types/trait.js';
import type { Page } from './types/page.js';
import type { Transition, Event, State } from './types/state-machine.js';

// ============================================================================
// Workflow Type Detection
// ============================================================================

/**
 * Standard CRUD state names used for workflow classification.
 * @internal
 */
const CRUD_STATES = new Set(['browsing', 'creating', 'editing', 'viewing', 'deleting']);

/**
 * Pattern for detecting wizard-style step states (step1, step2, etc).
 * @internal
 */
const STEP_PATTERN = /^step\d+$/i;

/**
 * Classify a workflow from its state machine states.
 *
 * - CRUD: 3+ states match {browsing, creating, editing, viewing, deleting}
 * - Wizard: 2+ states match /^step\d+$/i, OR linear chain to terminal state
 * - Custom: everything else
 */
export function classifyWorkflow(states: State[]): 'crud' | 'wizard' | 'custom' {
  const names = states.map(s => s.name.toLowerCase());

  const crudMatch = names.filter(n => CRUD_STATES.has(n)).length;
  if (crudMatch >= 3) return 'crud';

  const stepCount = names.filter(n => STEP_PATTERN.test(n)).length;
  if (stepCount >= 2) return 'wizard';

  const hasTerminal = states.some(s => s.isTerminal || s.isFinal);
  const hasComplete = names.some(n =>
    n === 'complete' || n === 'completed' || n === 'done' || n === 'finished'
  );
  if ((hasTerminal || hasComplete) && states.length >= 4 && crudMatch <= 1) {
    return 'wizard';
  }

  return 'custom';
}

// ============================================================================
// Entity Summarization
// ============================================================================

/**
 * Check if a field is a primary key.
 * @internal
 */
function isPrimaryKey(field: EntityField): boolean {
  return field.primaryKey === true;
}

/**
 * Check if a field is a business field (not primary key, has business meaning).
 * @internal
 */
function isBusinessField(field: EntityField): boolean {
  if (isPrimaryKey(field)) return false;
  if (field.type === 'enum' || field.type === 'relation') return true;
  if (field.required) return true;
  return false;
}

/**
 * Summarize an entity to its business-relevant fields.
 * @internal
 */
function summarizeEntity(entity: Entity): Entity {
  const fields: EntityField[] = entity.fields.filter(isBusinessField).map(summarizeField);
  return {
    name: entity.name,
    collection: entity.collection,
    fields,
  };
}

function summarizeField(f: EntityField): EntityField {
  if (f.type === 'enum') {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: 'enum',
      values: f.values,
      ...(f.required ? { required: true } : {}),
    };
  }
  if (f.type === 'union') {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: 'union',
      values: f.values,
      ...(f.required ? { required: true } : {}),
    };
  }
  if (f.type === 'relation') {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: 'relation',
      relation: f.relation,
      ...(f.required ? { required: true } : {}),
    };
  }
  if (f.type === 'array') {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: 'array',
      items: f.items,
      ...(f.required ? { required: true } : {}),
    };
  }
  if (f.type === 'tuple') {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: 'tuple',
      properties: f.properties,
      ...(f.required ? { required: true } : {}),
    };
  }
  if (f.type === 'object') {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: 'object',
      ...(f.required ? { required: true } : {}),
    };
  }
  if (f.type === 'field') {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: 'field',
      ...(f.record !== undefined ? { record: f.record } : {}),
      ...(f.items !== undefined ? { items: summarizeField(f.items) } : {}),
      ...(f.required ? { required: true } : {}),
    };
  }
  if (isTypeVariableField(f)) {
    return {
      ...(f.name !== undefined ? { name: f.name } : {}),
      type: f.type,
      ...(f.required ? { required: true } : {}),
    };
  }
  return {
    ...(f.name !== undefined ? { name: f.name } : {}),
    type: f.type,
    ...(f.required ? { required: true } : {}),
  };
}

// ============================================================================
// Transition Summarization
// ============================================================================

/**
 * Deduplicate transitions that are identical in (from, to, event).
 * Strips effects and guards.
 */
/**
 * Deduplicate transitions that are identical in (from, to, event).
 * Strips effects and guards.
 * @internal
 */
function summarizeTransitions(transitions: Transition[]): Transition[] {
  const seen = new Set<string>();
  const result: Transition[] = [];

  for (const t of transitions) {
    const key = `${t.from}::${t.to}::${t.event}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ from: t.from, to: t.to, event: t.event });
    }
  }

  return result;
}

// ============================================================================
// Trait Summarization
// ============================================================================

/**
 * Summarize events to just their keys.
 * @internal
 */
function summarizeEvents(events: Event[]): Event[] {
  return events.map(e => ({ key: e.key, name: e.key }));
}

/**
 * Summarize a trait to its essential structure.
 * @internal
 */
function summarizeTrait(trait: Trait): Trait {
  const states = trait.stateMachine?.states ?? [];
  const events = trait.stateMachine?.events ?? [];
  const transitions = trait.stateMachine?.transitions ?? [];

  const result: Trait = { name: trait.name };
  if (trait.linkedEntity) result.linkedEntity = trait.linkedEntity;

  if (trait.stateMachine) {
    result.stateMachine = {
      states: states.map(s => {
        const st: State = { name: s.name };
        if (s.isInitial) st.isInitial = true;
        if (s.isTerminal) st.isTerminal = true;
        if (s.isFinal) st.isFinal = true;
        return st;
      }),
      events: summarizeEvents(events),
      transitions: summarizeTransitions(transitions),
    };
  }

  if (trait.emits && trait.emits.length > 0) {
    result.emits = trait.emits.map(e => ({
      event: e.event,
      ...(e.scope ? { scope: e.scope } : {}),
    }));
  }

  if (trait.listens && trait.listens.length > 0) {
    result.listens = trait.listens.map(l => ({
      event: l.event,
      triggers: l.triggers,
      ...(l.scope ? { scope: l.scope } : {}),
    }));
  }

  return result;
}

// ============================================================================
// Page Summarization
// ============================================================================

/**
 * Summarize a page to its essential structure.
 * @internal
 */
function summarizePage(page: Page): Page {
  const result: Page = { name: page.name, path: page.path };
  if (page.protocol !== undefined) result.protocol = page.protocol;
  if (page.address !== undefined) result.address = page.address;
  if (page.traits && page.traits.length > 0) {
    result.traits = page.traits.map(t => ({ ref: t.ref }));
  }
  return result;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Summarize a single orbital into its business skeleton.
 *
 * OrbitalDefinition in → OrbitalDefinition out.
 * Strips effects, guards, payloads, theme, optional fields.
 * Deduplicates transitions on (from, to, event).
 */
export function summarizeOrbital(orbital: OrbitalDefinition): OrbitalDefinition {
  let entity: Entity;
  if (isEntityReference(orbital.entity)) {
    entity = { name: orbital.entity, fields: [] };
  } else if (isEntityCall(orbital.entity)) {
    // EntityCall (Phase F): synthesize a placeholder Entity from the call shape.
    // The full inlined entity is only available after the compiler's inline phase.
    const call = orbital.entity;
    const name = call.name ?? parseEntityRef(call.extends)?.alias ?? call.extends;
    entity = {
      name,
      fields: call.fields ?? [],
      ...(call.persistence ? { persistence: call.persistence } : {}),
      ...(call.collection ? { collection: call.collection } : {}),
    };
  } else {
    entity = summarizeEntity(orbital.entity);
  }

  const traits = orbital.traits.map(traitRef => {
    if (isInlineTrait(traitRef)) {
      return summarizeTrait(traitRef);
    }
    return traitRef;
  });

  const pages = orbital.pages
    .filter((p): p is Page => typeof p === 'object' && 'name' in p && !('ref' in p))
    .map(summarizePage);

  return { name: orbital.name, entity, traits, pages };
}

/**
 * Summarize an entire OrbitalSchema into a business skeleton.
 *
 * OrbitalSchema in → OrbitalSchema out.
 * Strips schema-level metadata (domainContext, design, designTokens, customPatterns).
 */
export function summarizeSchema(schema: OrbitalSchema): OrbitalSchema {
  return {
    name: schema.name,
    description: schema.description,
    version: schema.version,
    orbitals: schema.orbitals.map(summarizeOrbital),
  };
}
