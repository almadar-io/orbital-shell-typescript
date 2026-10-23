/**
 * Row-predicate helpers the TS shell keeps. Compiling a `filter` or `@read` to a `RowPredicate` is the kernel's
 * (`compile_predicate`; `kernelEvaluator().readPolicy`); this module holds only the binding-fold result shape the
 * kernel answers and the fetch-order parse.
 */
import type { RowOrder } from './service-types.js';

export type RowBindingScalar = string | number | boolean | null;

export type RowBindingResult =
  | { kind: 'value'; value: RowBindingScalar }
  | { kind: 'list'; values: RowBindingScalar[] }
  | { kind: 'unspecialised'; detail: string }
  | { kind: 'inexpressible'; detail: string };

/** A fetch's `orderBy` (`"field"` or `"field:asc|desc"`): ascending unless `desc`. */
export function parseFetchOrder(orderBy: string | undefined): RowOrder | undefined {
  if (typeof orderBy !== 'string' || orderBy === '') return undefined;
  const [field, direction] = orderBy.split(':');
  const dir: RowOrder['direction'] = direction === 'desc' ? 'desc' : 'asc';
  return { field, direction: dir };
}
