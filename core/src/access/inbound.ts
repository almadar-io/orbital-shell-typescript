/**
 * Declared inbound deliveries — the `/api/hooks/<name>` requests a program accepts from outside
 * (a provider's webhook). The app declares the names (`inbound: ["google-calendar"]`) and a trait
 * declares the handler (`listens { EVENT -> inbound "name" answers ANSWER { … } }`, lowered onto
 * its `stateMachine.events[]` entry as `inbound`). The host only carries bytes: it hands the
 * runtime `{headers, rawBody}` and writes back the answer the runtime returns (EXEC-INBOUND-1).
 * Mirrors `orbital-core/crates/base/src/inbound.rs`.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from '../types/schema.js';
import { EventPayloadValueSchema, type EventPayload, type EventPayloadValue } from '../types/expression.js';
import { isInlineTrait } from '../types/trait.js';

import type { InboundVerification } from '../types/state-machine.js';

export type { InboundDeclaration, InboundVerification } from '../types/state-machine.js';

/** One declared handler: the trait and event a hook name is delivered to, and the event that answers. */
export interface InboundRoute {
  name: string;
  orbital: string;
  trait: string;
  event: string;
  answer: string;
  verifies?: InboundVerification;
}

/** What a host carries of one request: its headers and its body text exactly as received. */
export interface InboundDelivery {
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: string;
}

/** The HTTP answer the host writes: the status and the JSON text of the body. */
export interface InboundAnswer {
  status: number;
  body: string;
  stderr?: string;
  /** Response headers the answer declares; a terminal host reads `orb-run` (twin of the kernel's `InboundAnswer.headers`). */
  headers?: Record<string, string>;
}

/** The declared `headers` of an answer: absent or null is none, a map of strings is them, anything else is invalid. */
function answerHeaders(value: EventPayloadValue | undefined): Record<string, string> | undefined | false {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return false;
    out[key] = entry;
  }
  return out;
}

export function inboundRoutesOf(schema: OrbitalSchema): InboundRoute[] {
  const out: InboundRoute[] = [];
  for (const orbital of schema.orbitals ?? []) {
    for (const traitRef of orbital.traits ?? []) {
      if (!isInlineTrait(traitRef)) continue;
      for (const ev of traitRef.stateMachine?.events ?? []) {
        if (ev.inbound === undefined) continue;
        out.push({
          name: ev.inbound.name,
          orbital: orbital.name,
          trait: traitRef.name,
          event: ev.key,
          answer: ev.inbound.answers,
          ...(ev.inbound.verifies !== undefined ? { verifies: ev.inbound.verifies } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * The handler for `name`: declared by the app's `inbound` list AND by exactly one trait. Anything
 * else is a hook the program does not serve.
 */
export function findInbound(schema: OrbitalSchema, name: string): InboundRoute | undefined {
  if (!(schema.inbound ?? []).includes(name)) return undefined;
  const routes = inboundRoutesOf(schema).filter((r) => r.name === name);
  return routes.length === 1 ? routes[0] : undefined;
}

/**
 * The trait that handles `event` as an inbound hook in `orbital`, when a client-facing route's
 * request names it (`trait` is the request's target trait, undefined when it names none). Such a
 * request is refused: only the hook intake delivers an inbound event.
 */
export function inboundOnlyTrait(schema: OrbitalSchema, orbital: string, trait: string | undefined, event: string): string | undefined {
  return inboundRoutesOf(schema).find((r) => r.orbital === orbital && r.event === event && (trait === undefined || trait === r.trait))?.trait;
}

/** The refusal message for an inbound-only event named on a client-facing route. */
export function inboundOnlyMessage(trait: string, event: string): string {
  return `${trait}.${event} is an inbound hook event: only /api/hooks/<name> delivers it`;
}

function errorBody(message: string): string {
  return JSON.stringify({ error: message });
}

/** The answer for a hook name the program does not serve. */
export function unknownHook(name: string): InboundAnswer {
  return { status: 404, body: errorBody(`Unknown hook provider: ${name}`) };
}

/** The answer for a route whose `verifies` names a credential the host holds no value for: nothing runs. */
export function credentialUnset(credential: string): InboundAnswer {
  return { status: 401, body: errorBody(`credential ${credential} is not set`) };
}

/** The answer for a delivery whose dispatch failed; the sender retries a 5xx. */
export function dispatchFailed(message: string): InboundAnswer {
  return { status: 500, body: errorBody(message) };
}

function parsedBody(rawBody: string): EventPayloadValue {
  try {
    const parsed = EventPayloadValueSchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Equality in time that depends on the longer value only, never on where they differ. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/**
 * The payload an inbound event is delivered with: `headers` (names lower-cased; a name given
 * twice joins its values with `, `), `rawBody` exactly as received, `body`, the parsed JSON of
 * `rawBody` or null when it is empty or not JSON, and, when the route declares `verifies`,
 * `verified`: the comparison of the named header with the credential's value, which stays out of
 * the payload. An unset or empty credential never verifies; the dispatcher refuses it first (`credentialUnset`).
 */
export function inboundPayload(route: InboundRoute, delivery: InboundDelivery, credential?: string | null): EventPayload {
  const headers: EventPayload = {};
  for (const [name, value] of Object.entries(delivery.headers)) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    const prev = headers[key];
    headers[key] = typeof prev === 'string' ? `${prev}, ${value}` : value;
  }
  const payload: EventPayload = { headers, body: parsedBody(delivery.rawBody), rawBody: delivery.rawBody };
  if (route.verifies !== undefined) {
    const seen = headers[route.verifies.header];
    payload.verified = credential === undefined || credential === null || credential === '' ? false : constantTimeEquals(typeof seen === 'string' ? seen : '', credential);
  }
  return payload;
}

/**
 * The answer a dispatch produced: the first emit of the route's answer event, whose payload is
 * `{ status, body, stderr? }`. With none, the first effect failure of the handler is the message; a
 * dispatch that neither answered nor failed is `inbound-unanswered`; a payload of another shape
 * is `inbound-answer-invalid`.
 */
export function inboundAnswerOf(
  route: InboundRoute,
  emitted: readonly { event: string; payload?: EventPayload }[],
  failure?: string,
): InboundAnswer {
  const answer = emitted.find((e) => e.event === route.answer);
  if (answer === undefined) return dispatchFailed(failure ?? 'inbound-unanswered');
  const payload: EventPayload = answer.payload ?? {};
  const { status, body, stderr } = payload;
  const headers = answerHeaders(payload.headers);
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 && typeof body === 'string' && (stderr === undefined || typeof stderr === 'string') && headers !== false) {
    return {
      status,
      body,
      ...(stderr === undefined ? {} : { stderr }),
      ...(headers === undefined ? {} : { headers }),
    };
  }
  return dispatchFailed('inbound-answer-invalid');
}
