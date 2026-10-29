/**
 * Shared relation display resolution — the ONE owner of "how does a relation
 * value read on screen". Consumed by DocumentDetails (meta rail chips),
 * DetailPanel (field rows), and every column-bearing display pattern
 * (TableView, DataList, DataGrid, DataTable), so every surface resolves a
 * relation the same way instead of leaking "[object Object]" or raw ids.
 */
import type { FieldValue } from '@almadar/core';

/**
 * A hydrated relation row shown by the label of its injected relation option (the kernel labels each option by the
 * relation's declared `display` field), else by its record id; never "[object Object]". `null` when the value is
 * not a hydrated row with an id.
 */
export function relationLabel(
  value: FieldValue,
  options?: ReadonlyArray<{ value: string; label: string }>,
): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date)
    return null;
  const id = value.id;
  if (id === undefined || id === null) return null;
  const key = String(id);
  return options?.find((opt) => opt.value === key)?.label ?? key;
}

/**
 * Resolve any relation-shaped value to display labels:
 * - a hydrated row (or array of rows) → the injected `{value, label}` option for its id, else its id;
 * - a bare foreign id (or array of ids) → the injected `{value, label}`
 *   relation options (the same contract Form's selects consume), falling back
 *   to the raw id when no option matches;
 * - empty/null/undefined → [].
 */
export function relationDisplayLabels(
  value: FieldValue | undefined,
  options?: ReadonlyArray<{ value: string; label: string }>,
): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => relationDisplayLabels(item as FieldValue, options));
  }
  const hydrated = relationLabel(value, options);
  if (hydrated !== null) return [hydrated];
  const raw = String(value);
  const match = options?.find((opt) => opt.value === raw);
  return [match ? match.label : raw];
}

/**
 * Resolve one cell's display string when the field is relation-shaped —
 * a hydrated row/array (any pattern) or a bare foreign id backed by injected
 * `relationsData` options. Returns `undefined` for a non-relation cell (no
 * options declared and the value isn't a hydrated object) so the caller falls
 * through to its own scalar formatter; a relation cell with zero matching
 * options still resolves (falls back to the raw id via `relationDisplayLabels`).
 */
export function resolveRelationCellDisplay(
  value: FieldValue | undefined,
  options?: ReadonlyArray<{ value: string; label: string }>,
): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const isObjectShaped =
    typeof value === 'object' && !(value instanceof Date) ||
    (Array.isArray(value) && value.some((v) => v !== null && typeof v === 'object' && !(v instanceof Date)));
  if (!isObjectShaped && !options) return undefined;
  const labels = relationDisplayLabels(value, options);
  return labels.length > 0 ? labels.join(', ') : undefined;
}
