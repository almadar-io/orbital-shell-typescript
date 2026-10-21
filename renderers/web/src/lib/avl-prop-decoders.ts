/**
 * Typed decoders for the AVL organisms' rich props (G-CROSS-131): a `.lolo` value arrives as an
 * `EventPayloadValue` and is validated into the component's declared type field by field, so the
 * compiled app needs no cast. Pattern configs go through core's `PatternObjectSchema`.
 */

import { PatternObjectSchema, SExprDataSchema } from '@almadar/core';
import type { EditFocus, EditFocusLevel, EventPayload, EventPayloadValue } from '@almadar/core';
import type { PatternEventSource, PreviewNodeData, RenderUIEntry } from './avl-preview-converter';
import type { StateRole } from './avl-theme';
import type { OffsetInParent } from './selection-geometry';
import type { SelectedPattern } from '../components/avl/molecules/OrbPreviewNode';
import type { CanvasNodePlacement } from '../components/avl/organisms/FlowCanvas';

const STATE_ROLES: readonly StateRole[] = ['initial', 'terminal', 'hub', 'default'];
const STATUSES = ['idle', 'running', 'success', 'error'] as const;
const FOCUS_LEVELS: readonly EditFocusLevel[] = ['node', 'slot', 'field', 'effect', 'trait', 'page', 'orbital'];

function fail(what: string): never {
  throw new Error(`Invalid AVL prop value: ${what}`);
}

function isList(value: EventPayloadValue): value is readonly EventPayloadValue[] {
  return Array.isArray(value);
}

function record(value: EventPayloadValue, what: string): EventPayload {
  if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date || isList(value)) {
    fail(`${what} must be an object`);
  }
  return value;
}

function list(value: EventPayloadValue, what: string): readonly EventPayloadValue[] {
  if (!isList(value)) fail(`${what} must be a list`);
  return value;
}

function str(o: EventPayload, key: string): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${key} must be a string`);
  return v;
}

function optStr(o: EventPayload, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') fail(`${key} must be a string`);
  return v;
}

function num(o: EventPayload, key: string): number {
  const v = o[key];
  if (typeof v !== 'number') fail(`${key} must be a number`);
  return v;
}

function optNum(o: EventPayload, key: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number') fail(`${key} must be a number`);
  return v;
}

function optStrList(o: EventPayload, key: string): string[] | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  return list(v, key).map((item) => {
    if (typeof item !== 'string') fail(`${key} must hold strings`);
    return item;
  });
}

function oneOf<T extends string>(o: EventPayload, key: string, allowed: readonly T[]): T | undefined {
  const v = optStr(o, key);
  if (v === undefined) return undefined;
  const hit = allowed.find((a) => a === v);
  if (hit === undefined) fail(`${key} must be one of ${allowed.join(', ')}`);
  return hit;
}

function renderUIEntry(value: EventPayloadValue): RenderUIEntry {
  const o = record(value, 'pattern entry');
  return { slot: str(o, 'slot'), pattern: PatternObjectSchema.parse(o.pattern) };
}

function eventSource(value: EventPayloadValue): PatternEventSource {
  const o = record(value, 'event source');
  const fields = o.payloadFields;
  return {
    event: str(o, 'event'),
    patternType: str(o, 'patternType'),
    label: optStr(o, 'label'),
    path: str(o, 'path'),
    positionHint: num(o, 'positionHint'),
    payloadFields:
      fields === undefined || fields === null
        ? undefined
        : list(fields, 'payloadFields').map((f) => {
            const p = record(f, 'payload field');
            const required = p.required;
            if (required !== undefined && required !== null && typeof required !== 'boolean') fail('required must be a boolean');
            return { name: str(p, 'name'), type: str(p, 'type'), required: typeof required === 'boolean' ? required : undefined };
          }),
  };
}

/** Validates a node of the canvas preview (`OrbInspector node`). */
export function decodePreviewNodeData(value: EventPayloadValue): PreviewNodeData {
  const o = record(value, 'node');
  const label = oneOf(o, 'cardLabel', ['screen'] as const);
  const guard = o.guard;
  return {
    orbitalName: str(o, 'orbitalName'),
    traitName: optStr(o, 'traitName'),
    stateName: optStr(o, 'stateName'),
    transitionEvent: optStr(o, 'transitionEvent'),
    fromState: optStr(o, 'fromState'),
    toState: optStr(o, 'toState'),
    cardWidth: optNum(o, 'cardWidth'),
    cardLabel: label,
    enteredBy: optStrList(o, 'enteredBy'),
    patterns: list(o.patterns, 'patterns').map(renderUIEntry),
    eventSources: list(o.eventSources, 'eventSources').map(eventSource),
    layer: optStr(o, 'layer'),
    stateRole: oneOf(o, 'stateRole', STATE_ROLES),
    effectTypes: optStrList(o, 'effectTypes'),
    guard: guard === undefined ? undefined : guard === null ? null : SExprDataSchema.parse(guard),
    entityName: optStr(o, 'entityName'),
    persistence: optStr(o, 'persistence'),
    fieldCount: optNum(o, 'fieldCount'),
    traitCount: optNum(o, 'traitCount'),
    pageRoutes: optStrList(o, 'pageRoutes'),
    status: oneOf(o, 'status', STATUSES),
  };
}

function offsetInParent(value: EventPayloadValue): OffsetInParent {
  const o = record(value, 'offsetInParent');
  return {
    left: num(o, 'left'),
    top: num(o, 'top'),
    right: num(o, 'right'),
    bottom: num(o, 'bottom'),
    parentWidth: num(o, 'parentWidth'),
    parentHeight: num(o, 'parentHeight'),
  };
}

function editFocus(value: EventPayloadValue): EditFocus {
  const o = record(value, 'focus');
  const level = oneOf(o, 'level', FOCUS_LEVELS);
  if (level === undefined) fail('level is required');
  return {
    level,
    orbital: str(o, 'orbital'),
    trait: optStr(o, 'trait'),
    transition: optStr(o, 'transition'),
    state: optStr(o, 'state'),
    slot: optStr(o, 'slot'),
    path: optStr(o, 'path'),
    patternType: optStr(o, 'patternType'),
    entity: optStr(o, 'entity'),
    source: optStr(o, 'source'),
    label: str(o, 'label'),
  };
}

/** Validates an in-node pattern selection (`OrbInspector selectedPattern`). */
export function decodeSelectedPattern(value: EventPayloadValue): SelectedPattern {
  const o = record(value, 'selected pattern');
  const rect = o.rect;
  const offset = o.offsetInParent;
  return {
    patternType: str(o, 'patternType'),
    patternId: optStr(o, 'patternId'),
    nodeData: decodePreviewNodeData(o.nodeData),
    sourceTrait: optStr(o, 'sourceTrait'),
    rect:
      rect === undefined || rect === null
        ? undefined
        : (() => {
            const r = record(rect, 'rect');
            return { top: num(r, 'top'), left: num(r, 'left'), width: num(r, 'width'), height: num(r, 'height') };
          })(),
    selection: optStrList(o, 'selection'),
    offsetInParent: offset === undefined || offset === null ? undefined : offsetInParent(offset),
    focus: o.focus === undefined || o.focus === null ? undefined : editFocus(o.focus),
    elements: o.elements === undefined || o.elements === null ? undefined : list(o.elements, 'elements').map(editFocus),
  };
}

/** Validates persisted canvas node positions (`FlowCanvas nodePositions`). */
export function decodeNodePlacements(value: EventPayloadValue): Record<string, CanvasNodePlacement> {
  const o = record(value, 'nodePositions');
  const out: Record<string, CanvasNodePlacement> = {};
  for (const [id, placement] of Object.entries(o)) {
    const p = record(placement, `nodePositions.${id}`);
    out[id] = { x: num(p, 'x'), y: num(p, 'y'), width: optNum(p, 'width') };
  }
  return out;
}
