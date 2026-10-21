import { isFileValue, type FieldValue } from '@almadar/core';

/**
 * Get Nested Value Utility
 *
 * Safely retrieves nested values from objects using dot-notation paths.
 * Used by display components to support relation field access like "company.name".
 *
 * @packageDocumentation
 */

/**
 * Get a nested value from an object using a dot-notation path (e.g.
 * `"company.name"`, `"address.city"`). Single owner moved to
 * `@almadar/core/lib/get-nested-value` (Stage B B1-F) — emitted SERVER code
 * cannot import this render-substrate package, so the shared implementation
 * lives upstream. Re-exported here for `@almadar/ui`'s own consumers.
 */
export { getNestedValue } from '@almadar/core';

/**
 * Resolve a field value that may be a raw URL string (legacy `image`/`url` fields) or a
 * structured `file`-typed {@link FileValue} into the URL an `<img src>` can use. Gallery/card
 * grid image tiles only ever rendered the raw-string case before the file-type promotion —
 * this keeps them working once a field is retyped to `file`.
 */
export function resolveImageUrl(value: FieldValue | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (isFileValue(value)) {
    return value.url;
  }
  return undefined;
}

