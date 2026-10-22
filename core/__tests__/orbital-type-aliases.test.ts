import { describe, expect, it } from 'vitest';

import { OrbitalDefinitionSchema } from '../src/types/orbital.js';

describe('an orbital keeps its named type aliases through the zod parse', () => {
    const base = {
        name: 'CellsOrbital',
        entity: { name: 'Cell', fields: [{ name: 'id', type: 'string', required: true }] },
        traits: [],
        pages: [],
    };

    it('carries a record alias as its fields and a dictionary alias as one unnamed member', () => {
        const parsed = OrbitalDefinitionSchema.parse({
            ...base,
            types: {
                Point: [
                    { name: 'x', type: 'number', required: true },
                    { name: 'y', type: 'number', required: true },
                ],
                ImportCells: [{ name: '', type: 'Map<string,string>' }],
            },
        });
        expect(parsed.types?.Point).toHaveLength(2);
        expect(parsed.types?.ImportCells).toEqual([{ name: '', type: 'Map<string,string>' }]);
    });

    it('carries a tagged union alias as one unnamed union member whose properties are its variants', () => {
        const union = {
            name: '',
            type: 'union',
            properties: [
                { name: 'DrawShape', type: 'object', properties: [{ name: 'type', type: 'string', required: true }] },
                { name: 'DrawText', type: 'object', properties: [{ name: 'text', type: 'string' }] },
            ],
        };
        const parsed = OrbitalDefinitionSchema.parse({ ...base, types: { DrawItem: [union] } });
        expect(parsed.types?.DrawItem).toEqual([union]);
    });

    it('control: a dictionary alias still carries no properties', () => {
        const parsed = OrbitalDefinitionSchema.parse({ ...base, types: { Cells: [{ name: '', type: 'Map<string,string>' }] } });
        expect(parsed.types?.Cells).toEqual([{ name: '', type: 'Map<string,string>' }]);
    });

    it('control: a record alias member still needs a name', () => {
        const parsed = OrbitalDefinitionSchema.safeParse({
            ...base,
            types: { Point: [{ name: '', type: 'number' }, { name: 'y', type: 'number' }] },
        });
        expect(parsed.success).toBe(false);
    });

    it('control: an unnamed member still needs a type', () => {
        const parsed = OrbitalDefinitionSchema.safeParse({ ...base, types: { Cells: [{ name: '', type: '' }] } });
        expect(parsed.success).toBe(false);
    });
});
