import { describe, expect, it } from 'vitest';
import { OrbitalEntitySchema } from '../src/types/entity.js';

describe('entity @index nearest', () => {
    const entity = (index: Record<string, unknown>) => ({ name: 'Chunk', fields: [], indexes: [index] });

    it('accepts a nearest path with its vector field and dimension', () => {
        const parsed = OrbitalEntitySchema.parse(entity({ fields: ['kind'], nearest: { field: 'embedding', dimension: 1536 } }));
        expect(parsed.indexes?.[0].nearest).toEqual({ field: 'embedding', dimension: 1536 });
    });

    it('refuses an unknown nearest key and a dimension that is not a whole number above 0', () => {
        expect(OrbitalEntitySchema.safeParse(entity({ fields: [], nearest: { field: 'v', dimension: 3, metric: 'dot' } })).success).toBe(false);
        expect(OrbitalEntitySchema.safeParse(entity({ fields: [], nearest: { field: 'v', dimension: 0 } })).success).toBe(false);
        expect(OrbitalEntitySchema.safeParse(entity({ fields: [], nearest: { field: 'v', dimension: 1.5 } })).success).toBe(false);
    });

    it('control: an ordered path without nearest still parses', () => {
        expect(OrbitalEntitySchema.safeParse(entity({ fields: ['graphId'], orderBy: 'weight:desc' })).success).toBe(true);
    });
});
