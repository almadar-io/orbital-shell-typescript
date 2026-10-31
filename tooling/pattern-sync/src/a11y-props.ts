/**
 * Accessibility attribute family. A pattern whose component props extend
 * `A11yProps` (@almadar/core) forwards these to its element, so they join its
 * propsSchema — `.lolo` render-ui can then set them and the validator and the
 * compiled codegen admit them. Props the component declares itself keep their
 * own schema.
 */
import { A11Y_ATTRIBUTES } from "@almadar/core";
import type { PatternEntry } from "./types.js";

type PropsSchema = PatternEntry["propsSchema"];

export function withA11yProps(propsSchema: PropsSchema, forwardsA11y: boolean): PropsSchema {
  if (!forwardsA11y) return propsSchema;
  const out: PropsSchema = { ...propsSchema };
  for (const [name, attr] of Object.entries(A11Y_ATTRIBUTES)) {
    if (name in out) continue;
    out[name] = {
      types: [...attr.types],
      description: attr.description,
      ...(attr.enumValues ? { enumValues: [...attr.enumValues] } : {}),
      ...(attr.numericEnumValues ? { numericEnumValues: [...attr.numericEnumValues] } : {}),
    };
  }
  return out;
}
