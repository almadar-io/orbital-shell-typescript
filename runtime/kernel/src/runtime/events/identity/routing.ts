/**
 * Identity-keyed routing (Almadar Rabit V4, Phase 4 — interpreter path).
 *
 * The runtime routes cross-trait events by NAME today: the bus key is the
 * event name and source filtering compares orbital/trait name strings. A
 * mid-session rename (a ledger `curName` edit that updates a node's own
 * display name but deliberately does NOT rewrite the name strings held by
 * every reference) therefore breaks name routing — the emitter now stamps
 * the new name while the listener still holds the old one.
 *
 * These helpers make routing resolve by ID when the schema carries ids
 * (ledger-backed, V4), and fall back to name while dual-carry. Ids are the
 * stable edge keys: a rename never touches a node's id or any `*Id`
 * reference, so id-routed bindings survive it. Legacy id-free schemas take
 * the name path unchanged — byte-for-byte the previous behavior.
 *
 * @packageDocumentation
 */

import type { EventId } from '@almadar/core';

/**
 * The bus subscription/delivery key for an event. When an `eventId` is
 * present the key is the id (namespaced so it can never collide with a
 * bare event name); otherwise it is the event name (legacy path).
 *
 * The event ENVELOPE keeps the human name as its `type` — only the routing
 * key changes — so observability, the client re-broadcast wire shape, and
 * wildcard listeners are untouched.
 */
export function eventRouteKey(eventName: string, eventId?: EventId | string): string {
  return eventId ? `@evt:${eventId}` : eventName;
}
