import { describe, expect, it } from 'vitest';

import { ownerFieldsFromSchema } from '../src/mock/identityOwners.js';
import { EntityFieldSchema, type EntityField } from '../src/types/field.js';
import type { OrbitalSchema } from '../src/types/schema.js';

const MAP_OF_PEOPLE = {
    name: 'people',
    type: 'object',
    items: { type: 'relation', relation: { entity: 'Person', cardinality: 'one' }, intrinsic: true },
} as const;

describe('Map string <Entity> field shape', () => {
    it('parses a relation-shaped items with intrinsic on the map variant', () => {
        const parsed = EntityFieldSchema.parse(MAP_OF_PEOPLE);
        expect(parsed.type).toBe('object');
        expect(parsed.type === 'object' ? parsed.items : undefined).toEqual({
            type: 'relation',
            relation: { entity: 'Person', cardinality: 'one' },
            intrinsic: true,
        });
    });

    it('control: a relation items without a relation target is still refused', () => {
        expect(EntityFieldSchema.safeParse({ name: 'people', type: 'object', items: { type: 'relation' } }).success).toBe(false);
    });
});

describe('a relation nested in a map value is not an owner column', () => {
    const person = { name: 'Person', identity: true, fields: [{ name: 'id', type: 'string', required: true } as EntityField] };
    const schemaWith = (fields: EntityField[]): OrbitalSchema => ({
        name: 'app',
        version: '1.0.0',
        orbitals: [
            { name: 'PersonOrb', entity: person, traits: [], pages: [] },
            { name: 'DeskOrb', entity: { name: 'Desk', fields }, traits: [], pages: [] },
        ],
    });

    it('a map of identity rows contributes no owner field', () => {
        expect(ownerFieldsFromSchema(schemaWith([EntityFieldSchema.parse(MAP_OF_PEOPLE)]))).toEqual([]);
    });

    it('control: a direct non-intrinsic relation to the identity entity is an owner field', () => {
        const direct: EntityField = { name: 'ownerId', type: 'relation', relation: { entity: 'Person', cardinality: 'one' } };
        expect(ownerFieldsFromSchema(schemaWith([direct]))).toEqual(['Desk.ownerId']);
    });
});
