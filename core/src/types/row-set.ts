import { z } from "zod";
import { RowQuerySchema } from "../row-query.js";
import type { RowSetRef } from "../generated/kernel-wire.js";
import type { RuntimeValue } from "./json.js";

/** A fetched page by reference (`ids` the window, `total` the matches, `query` what produced it): the generated kernel wire type, one copy. */
export type { RowSetRef };

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
