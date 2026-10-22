/**
 * Shared-entity frame merge.
 *
 * The DRY primitive both execution paths share: several traits bound to one
 * `[shared]` entity each contribute field writes per frame, and exactly one
 * render trait paints the merged result. Both the JS interpreter (`@almadar/runtime`/
 * `@almadar/ui`) and the generated TypeScript (Rust
 * `orbital-shell-typescript` codegen) fold writes through this same
 * function, so the two execution paths merge state identically.
 *
 * @packageDocumentation
 */

import type { EntityRow, FieldValue } from '../types/entity.js';

/**
 * One field write a writer trait applies to the shared entity's running
 * scratch state within a frame.
 */
export interface EntityFieldWrite {
  readonly field: string;
  /** The frame's own value type (`EntityRow`'s): a writer may copy an absent field back. */
  readonly value: FieldValue | undefined;
}

/**
 * A shared-entity snapshot. Aliases the canonical `EntityRow` — the SAME
 * row shape every other entity-state surface in the codebase uses (guard
 * contexts, `traitFieldStatesRef`, `RuntimeEntityStore`) — so a shared
 * entity's snapshot needs no conversion at its boundaries.
 */
export type EntityFrameState = EntityRow;

/**
 * Field-level fold of ordered writes onto the current entity state. A
 * later write to the same field overwrites an earlier one (ordered);
 * fields absent from `orderedWrites` are carried over verbatim rather than
 * the whole object being replaced, so disjoint writers never clobber each
 * other.
 */
export function mergeEntityFrame(
  current: EntityFrameState,
  orderedWrites: readonly EntityFieldWrite[],
): EntityFrameState {
  if (orderedWrites.length === 0) return current;
  const next: EntityRow = { ...current };
  for (const write of orderedWrites) {
    next[write.field] = write.value;
  }
  return next;
}

/**
 * Resolves what a trait's `@entity` binding reads: a client-supplied
 * `frame` is UNTRUSTED (it travels on the wire as `EventRequest.fields`),
 * so it may only contribute keys on `allowedFrameKeys` (the entity's
 * `@intrinsic` fields) and never `id` — a real row column always wins over
 * the frame, and an explicit `id` argument wins over everything. Both
 * execution paths (the JS interpreter and the generated TS server) call
 * this so `@entity` layers identically: declared defaults < fetched row <
 * frame, with the row/id override on top.
 */
export function resolveEntityView(input: {
  readonly frame?: EntityRow;
  readonly row?: EntityRow | null;
  readonly id?: string;
  readonly allowedFrameKeys: readonly string[];
}): EntityRow {
  const { frame, row, id, allowedFrameKeys } = input;
  const view: EntityRow = {};
  if (frame) {
    for (const key of allowedFrameKeys) {
      if (key === 'id') continue;
      if (Object.prototype.hasOwnProperty.call(frame, key)) {
        view[key] = frame[key];
      }
    }
  }
  Object.assign(view, row ?? {});
  if (id !== undefined) view.id = id;
  return view;
}

/**
 * Strips frame/view-state keys from a row before it reaches the store, so
 * an untrusted client frame (or scratch view state) never gets persisted.
 * Both persist paths call this on the way to their store write.
 */
export function omitFrameFields(row: EntityRow, frameKeys: readonly string[]): EntityRow {
  const next: EntityRow = { ...row };
  for (const key of frameKeys) {
    delete next[key];
  }
  return next;
}
