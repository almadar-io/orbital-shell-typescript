/**
 * Deterministic self-relation forest — the ONE seeding policy for a
 * self-referential relation field (`Tag.parentId : Tag`, `ChatMessage.replies
 * : [ChatMessage]`), shared by every mock seeder.
 *
 * Before this module each seeder invented its own policy: the interpreted
 * path (`MockPersistenceAdapter`) built a deterministic binary forest for
 * `one`/`many-to-one` self-relations but handed `many` self-relations 2-4
 * RANDOM other-row ids, and the compiled path's seeder (`MockDataService`)
 * assigned every relation field — self or cross-entity, any cardinality — one
 * random id with no forest at all. Random cross-linking on a `many`
 * self-relation means every row ends up referenced by several others, so
 * under a default `onDelete: restrict` policy nothing is ever deletable — the
 * `std-realtime-chat` `ChatMessage.replies` case this module fixes.
 *
 * The forest guarantees exactly one root (row 0, never referenced by any
 * other row) and no cycles: row *i*'s parent is always row ⌊(i−1)/2⌋, a
 * strictly smaller index.
 *
 * @packageDocumentation
 */

import type { EntityRow } from '../types/entity.js';

/** Parent/children lookups over `rowIds`, in binary-forest order. */
export interface SelfRelationForest {
  /** Row *i*'s parent id, or `''` for the root (row 0). */
  parentOf: (index: number) => string | '';
  /** The (0, 1, or 2) ids of rows whose parent is row *i*. */
  childrenOf: (index: number) => string[];
}

/**
 * Build the forest over a set of already-generated row ids. Deterministic —
 * the same `rowIds` array always produces the same forest, no PRNG involved.
 */
export function selfRelationForest(rowIds: readonly string[]): SelfRelationForest {
  return {
    parentOf: (index: number) => (index === 0 ? '' : (rowIds[Math.floor((index - 1) / 2)] ?? '')),
    childrenOf: (index: number) => {
      const children: string[] = [];
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < rowIds.length) children.push(rowIds[left]!);
      if (right < rowIds.length) children.push(rowIds[right]!);
      return children;
    },
  };
}

/** Cardinalities that store the SCALAR parent id. Everything else (`many`,
 *  `one-to-many`, `many-to-many`) stores the children-id list. */
const SCALAR_PARENT_CARDINALITIES = new Set(['one', 'many-to-one']);

/**
 * Write a self-relation field over the forest derived from `rows`' own ids —
 * the scalar parent form for `one`/`many-to-one`, the children-id-list form
 * for `many`/`one-to-many`/`many-to-many`.
 *
 * `isExcluded`, when given, is asked per row/index before writing; each
 * seeder passes in whatever cell it has already deliberately stamped (an
 * owner column, a pre-authored value) so this pass never overwrites it — the
 * exclusion RULE stays with the caller, who alone knows what it stamped.
 */
export function linkSelfRelationField(
  rows: ReadonlyArray<EntityRow>,
  field: { readonly name: string; readonly cardinality?: string },
  isExcluded?: (row: EntityRow, index: number) => boolean,
): void {
  const rowIds = rows.map((row) => row.id ?? '');
  const forest = selfRelationForest(rowIds);
  const scalar = SCALAR_PARENT_CARDINALITIES.has(field.cardinality ?? 'many');
  rows.forEach((row, index) => {
    if (isExcluded?.(row, index)) return;
    row[field.name] = scalar ? forest.parentOf(index) : forest.childrenOf(index);
  });
}

/** Cardinalities that store ONE target id; everything else stores an id list. */
const SCALAR_TARGET_CARDINALITIES = new Set(['one', 'many-to-one']);

/**
 * A cross-entity relation value for row `index` (0-based), deterministic and PRNG-free so every
 * seeder links identically whatever else it draws: a scalar relation takes `targetIds[index % n]`;
 * a list takes 2 (even rows) or 3 (odd rows) consecutive distinct ids from offset `index`. Twin of
 * `orbital-core/src/runtime/seed.rs` `link_relation_fields`. `undefined` when there is no target.
 */
export function crossRelationValue(
  targetIds: readonly string[],
  index: number,
  cardinality?: string,
): string | string[] | undefined {
  if (targetIds.length === 0) return undefined;
  if (SCALAR_TARGET_CARDINALITIES.has(cardinality ?? 'many')) return targetIds[index % targetIds.length];
  const picks: string[] = [];
  const count = Math.min(targetIds.length, 2 + (index % 2));
  for (let offset = 0; offset < count; offset++) {
    const candidate = targetIds[(index + offset) % targetIds.length]!;
    if (!picks.includes(candidate)) picks.push(candidate);
  }
  return picks;
}

/** A relation cell a seeder may fill: missing, or the `''` / `[]` placeholder `sampleRow` writes. */
export function isRelationPlaceholder(value: EntityRow[string]): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string') return value === '';
  return Array.isArray(value) && value.length === 0;
}
