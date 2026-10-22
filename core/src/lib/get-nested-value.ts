/**
 * `getNestedValue` — safely retrieve a nested value from an object using a
 * dot-notation path (e.g. `"company.address.city"`).
 *
 * Single owner moved here from `@almadar/ui/lib/getNestedValue` (Stage B
 * B1-F): emitted SERVER code cannot import `@almadar/ui` (a render-substrate
 * package), so a helper server-side codegen needs — reading a listen
 * payload's mapped field, a template binding, a display column — has to
 * live in core. `@almadar/ui/lib` re-exports this symbol for its own
 * consumers.
 *
 * @packageDocumentation
 */
import type { EventPayload, EventPayloadValue, FieldValue } from '../types/index.js';
import type { UserContext } from '../types/user.js';

type NestedValueInput =
  | EventPayload
  | EventPayloadValue
  | FieldValue
  | Record<string, FieldValue | undefined>
  | UserContext
  | null
  | undefined;

/**
 * Get a nested value from an object using a dot-notation path.
 *
 * Widened over the UI original to admit every shape a payload/field value
 * can hold (`EventPayload`, `EventPayloadValue`, `FieldValue`) — a `string`,
 * `number` or `Date` at any level bails to `undefined`; an array is indexed by a
 * numeric segment (`"rows.0.name"`), matching `object/get` in both evaluators.
 *
 * @example
 * const data = { company: { name: "Acme Corp", address: { city: "NYC" } } };
 * getNestedValue(data, "company.name");         // => "Acme Corp"
 * getNestedValue(data, "company.address.city"); // => "NYC"
 * getNestedValue(data, "company.missing");      // => undefined
 */
export function getNestedValue(obj: NestedValueInput, path: string): FieldValue | undefined {
  if (obj === null || obj === undefined || !path) return undefined;
  if (typeof obj !== 'object') return undefined;

  // Fast path: no dots means simple property access.
  if (!path.includes('.') && !Array.isArray(obj)) {
    return (obj as Record<string, FieldValue | undefined>)[path];
  }

  let value: NestedValueInput = obj;
  for (const part of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    // An array is indexed by a numeric segment, as `object/get` does in both evaluators.
    if (Array.isArray(value)) {
      if (!/^\d+$/.test(part)) return undefined;
      value = (value as readonly NestedValueInput[])[Number(part)];
      continue;
    }
    value = (value as Record<string, FieldValue | undefined>)[part];
  }

  return value as FieldValue | undefined;
}
