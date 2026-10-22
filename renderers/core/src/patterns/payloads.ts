/**
 * Canonical emit-payload shapes for framework data patterns.
 *
 * The patterns (DataGrid, DataList, Timeline, CardGrid, List, Form,
 * InfiniteScrollSentinel, SortableList, ...) dispatch events via
 * `eventBus.emit` with these payload shapes. Typing them once here means
 * every emit site and every listener agrees on the contract — no more
 * inline `{ row: itemData }` literals that erase the entity type, and
 * no more `itemData: Record<string, unknown>` at the receiver.
 *
 * Pattern-specific payload contracts live here (in `@almadar/patterns`)
 * because they're pattern-level contracts — the framework-level generic
 * primitives (`EventPayloadValue`, `FieldValue`) stay in `@almadar/core`.
 * Patterns import the primitives and build named payload shapes on top
 * of them.
 *
 * Consumers:
 * - Component authors import the relevant payload type at the emit site
 *   and use `satisfies` to assert conformance without widening.
 * - Generated trait reducers receive the payload typed as one of these
 *   shapes, so a SAVE transition handler for a Form sees
 *   `FormSubmitPayload<T>`, not `unknown`.
 * - Verifiers can eventually assert "trait event X's declared payload
 *   matches the pattern's emit shape" once the patterns registry carries
 *   a per-prop `payloadShape` reference (follow-up — not in 2.17.0).
 *
 * @packageDocumentation
 */

import type { EventPayload, EventPayloadValue } from '../types/expression.js';
import type { FieldValue } from '../types/entity.js';

/**
 * Payload dispatched by per-item action buttons in data patterns
 * (DataGrid, DataList, Timeline, CardGrid, List, ...).
 *
 * When a user clicks an itemAction, the pattern emits `UI:{action.event}`
 * with this payload. The trait reducer gets both the row's id (lookups,
 * delete, update) AND the full row for downstream logic (opening a
 * detail panel pre-filled with the row, computing a derived value,
 * etc.).
 *
 * Generic over the row shape. `DataGridItemAction` used on `CartItem[]`
 * gives the trait `ItemActionPayload<CartItem>`, not `unknown`.
 *
 * Intersected with `EventPayload` so the whole thing is structurally
 * compatible with `eventBus.emit`'s typed parameter — interfaces alone
 * aren't assignable to `EventPayload`'s index signature in strict mode.
 */
export type ItemActionPayload<T extends EventPayloadValue = EventPayloadValue> = EventPayload & {
  /** Row primary key. */
  id: string | number;
  /** Full row data at click time. */
  row: T;
};

/**
 * Payload dispatched when a selection-capable data pattern observes a
 * selection change (`selectionEvent` on DataGrid / DataList / ...).
 * Carries every currently-selected row id; the receiving trait can
 * reconcile against its row set to recompute derived state ("bulk
 * enabled", "3 items selected", etc.).
 */
export type SelectionChangePayload = EventPayload & {
  selectedIds: readonly string[];
};

/**
 * Payload dispatched when an infinite-scroll-enabled pattern's sentinel
 * becomes visible (`loadMoreEvent` on DataGrid / DataList /
 * InfiniteScrollSentinel).
 *
 * No fields required — the receiving trait knows its own cursor (last
 * loaded page, current offset). Declared as `EventPayload` (the empty-
 * object bound) so consumers can pass `{}` and listeners can
 * destructure without runtime checks.
 */
export type LoadMoreRequestPayload = EventPayload;

/**
 * Payload dispatched by an emoji-choosing pattern (`pickEvent` on
 * EmojiPicker) when the user picks a glyph. The receiving trait appends
 * the glyph to a draft, records a reaction, etc.
 */
export type EmojiPickPayload = EventPayload & {
  /** The chosen emoji glyph (e.g. "😀"). */
  emoji: string;
};

/**
 * Payload dispatched by a schema-driven `Form` on successful submit
 * (`submitEvent`). `data` holds the form's collected field values.
 *
 * Generic over the field-value bag so a typed `Form<Partial<CartItem>>`
 * passes `FormSubmitPayload<Partial<CartItem>>` to the trait's SAVE
 * handler, and a generic form falls back to the `FieldValue`-keyed
 * default.
 */
export type FormSubmitPayload<
  T extends Record<string, FieldValue | undefined> = Record<string, FieldValue | undefined>,
> = EventPayload & {
  data: T;
};
