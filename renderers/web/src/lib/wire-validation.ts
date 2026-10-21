/**
 * Wire Validation
 *
 * Validates event wire compatibility between behaviors based on typed payloads.
 * Used by FlowCanvas when the user drags between event handles.
 */

export interface PayloadField {
  name: string;
  type: string;
  required?: boolean;
}

export interface WireValidationResult {
  valid: boolean;
  warnings: string[];
}

/**
 * Validate that a wire between two event handles is payload-compatible.
 *
 * Rules:
 * - If neither side declares a payload, the wire is valid (no data contract).
 * - If source has payload but target doesn't, valid with info (data is unused).
 * - If target expects required fields that source doesn't provide, warn.
 * - If both have fields with the same name but different types, warn.
 */
export function validateWire(
  sourcePayload: PayloadField[] | undefined,
  targetPayload: PayloadField[] | undefined,
): WireValidationResult {
  const warnings: string[] = [];

  // No payload on either side: always valid
  if (!sourcePayload?.length && !targetPayload?.length) {
    return { valid: true, warnings };
  }

  // Source has payload, target doesn't: valid (data flows but is ignored)
  if (sourcePayload?.length && !targetPayload?.length) {
    return { valid: true, warnings };
  }

  // Target expects payload but source provides none
  if (!sourcePayload?.length && targetPayload?.length) {
    const requiredFields = targetPayload.filter(f => f.required);
    if (requiredFields.length > 0) {
      warnings.push(`Missing required fields: ${requiredFields.map(f => f.name).join(', ')}`);
    }
    return { valid: warnings.length === 0, warnings };
  }

  // Both have payloads: check field compatibility
  const sourceFields = new Map(sourcePayload!.map(f => [f.name, f]));
  for (const targetField of targetPayload!) {
    const sourceField = sourceFields.get(targetField.name);
    if (!sourceField) {
      if (targetField.required) {
        warnings.push(`Missing required field: ${targetField.name} (${targetField.type})`);
      }
    } else if (sourceField.type !== targetField.type) {
      warnings.push(`Type mismatch: ${targetField.name} (source: ${sourceField.type}, target: ${targetField.type})`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Format payload fields into a tooltip string.
 * Example: "{ data: object (req), query: string }"
 */
export function formatPayloadTooltip(fields: PayloadField[]): string {
  if (fields.length === 0) return '';
  const parts = fields.map(f =>
    `${f.name}: ${f.type}${f.required ? ' (req)' : ''}`
  );
  return `{ ${parts.join(', ')} }`;
}
