// The one identity of a cascade delivery (Runtime Spec Clause 5.3); twin of orbital-core `dispatch_visit_key`.
import type { EventPayload, EventPayloadValue } from './expression.js';

function isPayloadList(value: EventPayloadValue | undefined): value is EventPayloadValue[] {
  return Array.isArray(value);
}

/** An absent payload (`undefined`) writes `null`, as an explicit `null` does. */
export function canonicalJson(value: EventPayloadValue | undefined): string {
  if (value === undefined || value === null) return 'null';
  if (isPayloadList(value)) return `[${value.map((item: EventPayloadValue) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const fields = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * `(trait, event, from, payload, frame)`: only an exact repeat of all five is a cycle. The frame is the
 * trait's entity row as it stands when the step is taken — a loop whose row moved on is progress even
 * when an effect hands back the same result twice; `null` when the trait has no row.
 */
export function dispatchVisitKey(
  trait: string,
  event: string,
  from: string,
  payload: EventPayload | null | undefined,
  frame: EventPayload | null,
): string {
  return `${trait}\u0000${event}\u0000${from}\u0000${canonicalJson(payload)}\u0000${canonicalJson(frame)}`;
}

const COMPOSITE: unique symbol = Symbol('composite');

/** The JSON leaf `canonicalJson` writes for a scalar (an absent value and a non-finite number both write `null`). */
function canonicalLeaf(value: EventPayloadValue | undefined): string | number | boolean | null | typeof COMPOSITE {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') return COMPOSITE;
  return value;
}

/** `canonicalJson(a) === canonicalJson(b)`, without building either string. */
function sameCanonical(a: EventPayloadValue | undefined, b: EventPayloadValue | undefined): boolean {
  if (a === b) return true;
  const leafA = canonicalLeaf(a);
  const leafB = canonicalLeaf(b);
  if (leafA !== COMPOSITE || leafB !== COMPOSITE) return leafA === leafB;
  if (isPayloadList(a) || isPayloadList(b)) {
    if (!isPayloadList(a) || !isPayloadList(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameCanonical(item, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((k) => k in b && sameCanonical(a[k], b[k]));
}

interface Visit {
  payload: EventPayload | null;
  frame: EventPayload | null;
}

/**
 * A set of deliveries under the `dispatchVisitKey` identity. Steps are filed by `(trait, event, from)`;
 * payload and frame are compared only against earlier visits of that same step, so a large entity
 * frame is not serialized on every cascade step. Payload and frame are kept as their top-level fields
 * stood when recorded: a step reassigns entity fields in place, nested values are never mutated.
 */
export class DispatchVisits {
  private readonly steps = new Map<string, Visit[]>();

  has(trait: string, event: string, from: string, payload: EventPayload | null | undefined, frame: EventPayload | null): boolean {
    const seen = this.steps.get(`${trait}\u0000${event}\u0000${from}`);
    return seen !== undefined && seen.some((v) => sameCanonical(v.payload, payload) && sameCanonical(v.frame, frame));
  }

  add(trait: string, event: string, from: string, payload: EventPayload | null | undefined, frame: EventPayload | null): void {
    if (this.has(trait, event, from, payload, frame)) return;
    const step = `${trait}\u0000${event}\u0000${from}`;
    const visit: Visit = {
      payload: payload === undefined || payload === null ? null : { ...payload },
      frame: frame === null ? null : { ...frame },
    };
    const seen = this.steps.get(step);
    if (seen === undefined) this.steps.set(step, [visit]);
    else seen.push(visit);
  }
}
