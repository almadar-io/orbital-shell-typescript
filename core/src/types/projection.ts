import { z } from 'zod';

/**
 * `.lolo` `T.f` in any type position — the declared field `field` of the entity or struct
 * type `type`. A field carrying it holds `T.f`'s declared type itself; `projectedFrom` records
 * where it came from, so a value can be drawn from `T`'s own `f` (the mock seeder draws from
 * `T`'s seeded rows). Mirrors Rust `FieldProjection`.
 */
export type FieldProjection = {
    type: string;
    field: string;
};

export const FieldProjectionSchema: z.ZodType<FieldProjection> = z.object({
    type: z.string().min(1),
    field: z.string().min(1),
});
