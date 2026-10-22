import { z } from "zod";
import { RowQuerySchema } from "../row-query.js";
import type { RowQuery } from "../service-types.js";
import type { RuntimeValue } from "./json.js";

/**
 * A fetched page by reference: `ids` = the window in order, `total` = matches before the window at
 * dispatch time, `query` = what produced it (its predicates, incl. the @read policy, re-count `total`; order and window are ignored).
 */
export interface RowSetRef {
  entityType: string;
  ids: string[];
  total: number;
  query: RowQuery;
}

export const RowSetRefSchema: z.ZodType<RowSetRef> = z.object({
  entityType: z.string(),
  ids: z.array(z.string()),
  total: z.number().int().nonnegative(),
  query: RowQuerySchema,
});

/** Tag property of a `RowSetMarker`; `$`-prefixed so it never collides with a pattern prop key. */
export const ROW_SET_MARKER = "$rowSet" as const;

/** A render prop leaf resolved to rows at paint time by the kernel (`@read` applied there). */
export type RowSetMarker = {
  readonly [ROW_SET_MARKER]: true;
  readonly ref: RowSetRef;
};

export function rowSetMarker(ref: RowSetRef): RowSetMarker {
  return { [ROW_SET_MARKER]: true, ref };
}

export function isRowSetMarker(value: RuntimeValue): value is RowSetMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ROW_SET_MARKER in value &&
    value[ROW_SET_MARKER] === true &&
    "ref" in value &&
    RowSetRefSchema.safeParse(value.ref).success
  );
}
