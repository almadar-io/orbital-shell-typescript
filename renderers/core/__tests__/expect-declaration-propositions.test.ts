import { describe, expect, it } from 'vitest';

import { EntitySchema } from '../src/types/entity.js';
import { ExpectDeclarationSchema } from '../src/types/orbital.js';
import { StateSchema, TransitionSchema } from '../src/types/state-machine.js';

describe('spec propositions on expectations', () => {
    it('accepts row invariants on an entity expectation and holds on a state expectation', () => {
        const entity = { kind: 'entity', name: 'Order', strict: true, invariants: [['>=', '@entity.total', 0]] };
        const state = { kind: 'state', traitName: 'Checkout', state: 'paid', strict: true, holds: ['=', '@entity.status', 'paid'] };
        expect(ExpectDeclarationSchema.parse(entity)).toEqual(entity);
        expect(ExpectDeclarationSchema.parse(state)).toEqual(state);
    });
    it('control: an expectation without propositions is unchanged', () => {
        const bare = { kind: 'state', traitName: 'Checkout', state: 'paid' };
        expect(ExpectDeclarationSchema.parse(bare)).toEqual(bare);
    });
    it('refuses invariants that are not a list', () => {
        expect(ExpectDeclarationSchema.safeParse({ kind: 'entity', name: 'Order', invariants: '@entity.total' }).success).toBe(false);
    });
});

describe('propositions on real declarations and on the transition expectation', () => {
    const ensures = [['=', '@entity.balance', ['-', '@fromEntity.balance', '@payload.amount']]];
    it('accepts ensures on a transition expectation', () => {
        const t = { kind: 'transition', traitName: 'Wallet', from: 'active', event: 'SPEND', to: 'active', strict: true, ensures };
        expect(ExpectDeclarationSchema.parse(t)).toEqual(t);
    });
    it('control: a transition expectation without ensures is unchanged, and a non-list ensures is refused', () => {
        const bare = { kind: 'transition', traitName: 'Wallet', from: 'active', event: 'SPEND', to: 'active' };
        expect(ExpectDeclarationSchema.parse(bare)).toEqual(bare);
        expect(ExpectDeclarationSchema.safeParse({ ...bare, ensures: '@entity.balance' }).success).toBe(false);
    });
    it('accepts invariants on a real entity, holds on a state and ensures on a transition', () => {
        const entity = { name: 'Account', collection: 'accounts', fields: [{ name: 'balance', type: 'number' }], invariants: [['>=', '@entity.balance', 0]] };
        expect(EntitySchema.parse(entity).invariants).toEqual(entity.invariants);
        const state = { name: 'active', holds: ['>=', '@entity.balance', 0] };
        expect(StateSchema.parse(state)).toEqual(state);
        const tr = { from: 'active', to: 'active', event: 'SPEND', ensures };
        expect(TransitionSchema.parse(tr)).toEqual(tr);
    });
    it('control: the real declarations parse without propositions', () => {
        expect(StateSchema.parse({ name: 'active' })).toEqual({ name: 'active' });
        expect(TransitionSchema.parse({ from: 'a', to: 'b', event: 'E' })).toEqual({ from: 'a', to: 'b', event: 'E' });
    });
});

describe('config expectation', () => {
    it('accepts a required knob with its type and default', () => {
        const c = { kind: 'config', name: 'stdio', knob: { type: 'string', default: 'pipe' }, strict: true };
        expect(ExpectDeclarationSchema.parse(c)).toEqual(c);
    });
    it('control: a knob without a default is accepted, a missing knob is refused', () => {
        const bare = { kind: 'config', name: 'stdio', knob: { type: 'string' } };
        expect(ExpectDeclarationSchema.parse(bare)).toEqual(bare);
        expect(ExpectDeclarationSchema.safeParse({ kind: 'config', name: 'stdio' }).success).toBe(false);
    });
});
