import { z } from 'zod';

/**
 * `.lolo` `T` or `T.f` in any type position: the authored entity or struct type `type`, or its declared field `field`.
 * A field carrying it holds that type itself; `projectedFrom` records where it came from, so a value can be drawn from
 * `T`'s own rows or `f` (the mock seeder draws from `T`'s seeded rows). Mirrors Rust `FieldProjection`, whose `field`
 * is absent for a named type.
 */
export type FieldProjection = {
    type: string;
    field?: string;
};

export const FieldProjectionSchema: z.ZodType<FieldProjection> = z.object({
    type: z.string().min(1),
    field: z.string().min(1).optional(),
});
