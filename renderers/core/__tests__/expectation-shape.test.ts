import { describe, expect, it } from 'vitest';

import { mergeExpectationShape } from '../src/expectation-shape.js';
import type { EntityField } from '../src/types/field.js';
import { EntityIdSchema } from '../src/types/identity.js';

// The derivation's own cases moved with it to `orbital-core` (`tests/derive_expectations.rs`);
// the shape union stays here for the JS composer.
describe('canonical expectation shape union', () => {
    it('retains an explicit relation target identity', () => {
        const prior: EntityField = { name: 'owner', type: 'relation', relation: { entity: 'Member', cardinality: 'one' } };
        const incoming: EntityField = { ...prior, relation: { ...prior.relation, entityId: EntityIdSchema.parse('ent_01M4CP7RDD5PE3TMDYAGDG28BD') } };
        expect(mergeExpectationShape([prior], [incoming])).toEqual([incoming]);
    });
    it('rejects conflicting relation target identities despite equal displayed names', () => {
        const prior: EntityField = { name: 'owner', type: 'relation', relation: { entity: 'Member', cardinality: 'one', entityId: EntityIdSchema.parse('ent_01M4CP7RDD5PE3TMDYAGDG28BD') } };
        const incoming: EntityField = { ...prior, relation: { ...prior.relation, entityId: EntityIdSchema.parse('ent_01M4CPARK4JPKGG21HZN7ZQDHH') } };
        expect(() => mergeExpectationShape([prior], [incoming])).toThrow('expectation shape mismatch');
    });
    it('merges recursive properties, array items, requiredness, vocabulary and bounded ranges immutably', () => {
        const prior: EntityField[] = [{ name: 'profile', type: 'object', properties: { role: { type: 'string', values: ['member'], description: 'keep' }, count: { type: 'number', min: 1, max: 10 } } }, { name: 'rows', type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } }];
        const incoming: EntityField[] = [{ name: 'profile', type: 'object', properties: { count: { type: 'number', min: 3, max: 8 }, role: { type: 'enum', values: ['admin'], required: true, description: 'other' }, email: { type: 'email' } } }, { name: 'rows', type: 'array', items: { type: 'object', properties: { count: { type: 'number' } } } }];
        const before = structuredClone([prior, incoming]);
        expect(mergeExpectationShape(prior, incoming)).toEqual([{ name: 'profile', type: 'object', properties: { role: { type: 'string', values: ['member', 'admin'], required: true, description: 'keep' }, count: { type: 'number', min: 3, max: 8 }, email: { type: 'email' } } }, { name: 'rows', type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, count: { type: 'number' } } } }]);
        expect([prior, incoming]).toEqual(before);
    });
    it('accepts reordered structured keys and same-arity tuple constraints', () => {
        const prior: EntityField = { name: 'pair', type: 'tuple', properties: { '0': { type: 'string', default: 'first' }, '1': { type: 'object', properties: { a: { type: 'boolean' }, b: { type: 'number' } } } } };
        const incoming: EntityField = { name: 'pair', type: 'tuple', properties: { '1': { type: 'object', properties: { b: { type: 'number' }, a: { type: 'boolean' } } }, '0': { type: 'string', default: 'other', required: true } } };
        expect(mergeExpectationShape([prior], [incoming])?.[0]).toMatchObject({ properties: { '0': { default: 'first', required: true } } });
    });
    it.each<[EntityField, EntityField]>([
        [{ name: 'field', type: 'string' }, { name: 'field', type: 'number' }],
        [{ name: 'field', type: 'relation', relation: { entity: 'A', cardinality: 'one' } }, { name: 'field', type: 'relation', relation: { entity: 'B', cardinality: 'one' } }],
        [{ name: 'field', type: 'array', items: { type: 'string' } }, { name: 'field', type: 'array', items: { type: 'number' } }],
        [{ name: 'field', type: 'tuple', properties: { '0': { type: 'string' } } }, { name: 'field', type: 'tuple', properties: { '0': { type: 'string' }, '1': { type: 'string' } } }],
        [{ name: 'field', type: 'number', min: 5 }, { name: 'field', type: 'number', max: 3 }],
    ])('refuses incompatible constraints instead of dropping them', (prior, incoming) => {
        expect(() => mergeExpectationShape([prior], [incoming])).toThrow('expectation shape mismatch');
    });
});
