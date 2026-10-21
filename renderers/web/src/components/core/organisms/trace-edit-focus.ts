/**
 * Edit Focus — the contextual-edit selection contract for the trace chat bar.
 *
 * A canvas element-pick emits `UI:ELEMENT_SELECTED` on the EventBus carrying an
 * `EditFocus`. This module names that event and narrows the bus payload back
 * into a typed `EditFocus` for `ChatBar`'s focus chip. It depends only on
 * `@almadar/core` types; the DOM→focus build lives at the emitting canvas
 * (`avl/derive-edit-focus`), not here.
 */

import type {
  EditFocus,
  EditFocusLevel,
  EventPayload,
  EventPayloadValue,
} from '@almadar/core';

/** The dedicated bus event a canvas element-pick emits. */
export const ELEMENT_SELECTED_EVENT = 'UI:ELEMENT_SELECTED';

const EDIT_FOCUS_LEVELS: ReadonlySet<string> = new Set<string>([
  'node',
  'slot',
  'field',
  'effect',
  'trait',
  'page',
  'orbital',
]);

function asString(v: EventPayloadValue | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asLevel(v: EventPayloadValue | undefined): EditFocusLevel {
  if (typeof v === 'string' && EDIT_FOCUS_LEVELS.has(v)) {
    return v as EditFocusLevel;
  }
  return 'node';
}

/** A plain object payload (not a string/number/array/Date/null). */
function isEventPayload(v: EventPayloadValue | undefined): v is EventPayload {
  return v !== null && v !== undefined && typeof v === 'object'
    && !Array.isArray(v) && !(v instanceof Date);
}

/** Narrow a `UI:ELEMENT_SELECTED` payload value back into an `EditFocus`. */
export function parseEditFocus(value: EventPayloadValue | undefined): EditFocus | null {
  if (!isEventPayload(value)) return null;
  const payload: EventPayload = value;
  const orbital = asString(payload.orbital);
  if (orbital === undefined || orbital.length === 0) return null;

  const focus: EditFocus = {
    level: asLevel(payload.level),
    orbital,
    label: asString(payload.label) ?? orbital,
  };
  const trait = asString(payload.trait);
  if (trait !== undefined) focus.trait = trait;
  const transition = asString(payload.transition);
  if (transition !== undefined) focus.transition = transition;
  const state = asString(payload.state);
  if (state !== undefined) focus.state = state;
  const slot = asString(payload.slot);
  if (slot !== undefined) focus.slot = slot;
  const path = asString(payload.path);
  if (path !== undefined) focus.path = path;
  const patternType = asString(payload.patternType);
  if (patternType !== undefined) focus.patternType = patternType;
  const entity = asString(payload.entity);
  if (entity !== undefined) focus.entity = entity;
  const source = asString(payload.source);
  if (source !== undefined) focus.source = source;
  return focus;
}
