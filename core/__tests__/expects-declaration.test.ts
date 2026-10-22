import { describe, expect, it } from 'vitest';

import { OrbitalDefinitionSchema } from '../src/types/orbital.js';

/**
 * `z.object()` STRIPS unknown keys rather than rejecting them (the trap
 * documented in schema.ts), so `expects` must exist on BOTH the type and the
 * zod schema or it silently vanishes on the interpreter path. These tests are
 * the guard — the same pattern as identity-entity-tag.test.ts.
 * See docs/Almadar_LOLO_Expects_Proposal.md (E1).
 */
describe('orbital expects declarations survive the zod parse', () => {
    const base = {
        name: 'ProductOrbital',
        entity: { name: 'Product', fields: [{ name: 'id', type: 'string', required: true }] },
        traits: [],
        pages: [],
    };

    const expects = [
        {
            kind: 'identity',
            name: 'Customer',
            shape: [
                {
                    name: 'role',
                    type: 'enum',
                    values: ['store-manager', 'operations-director'],
                    required: true,
                },
            ],
        },
        {
            kind: 'entity',
            name: 'OrderRecord',
            shape: [
                { name: 'status', type: 'enum', values: ['placed', 'shipped', 'delivered'] },
                { name: 'totalAmount', type: 'number' },
            ],
        },
        { kind: 'entity', name: 'CartItem' },
        { kind: 'event', traitName: 'Checkout', event: 'ORDER_PLACED' },
    ];

    it('preserves all three kinds, typed shapes included', () => {
        const parsed = OrbitalDefinitionSchema.parse({ ...base, expects });
        expect(parsed.expects).toHaveLength(4);

        const [identity, order, cart, event] = parsed.expects!;
        expect(identity).toMatchObject({ kind: 'identity', name: 'Customer' });
        expect(identity.kind === 'identity' && identity.shape?.[0]).toMatchObject({
            name: 'role',
            type: 'enum',
            values: ['store-manager', 'operations-director'],
        });
        expect(order).toMatchObject({ kind: 'entity', name: 'OrderRecord' });
        expect(cart).toMatchObject({ kind: 'entity', name: 'CartItem' });
        expect('shape' in cart && cart.shape !== undefined).toBe(false);
        expect(event).toMatchObject({ kind: 'event', traitName: 'Checkout', event: 'ORDER_PLACED' });
    });

    it('leaves expects absent when not declared (no key invented)', () => {
        const parsed = OrbitalDefinitionSchema.parse(base);
        expect('expects' in parsed).toBe(false);
    });

    it('rejects a malformed declaration (unknown kind)', () => {
        expect(() =>
            OrbitalDefinitionSchema.parse({ ...base, expects: [{ kind: 'service', name: 'X' }] }),
        ).toThrow();
    });

    it('round-trips through JSON without loss', () => {
        const parsed = OrbitalDefinitionSchema.parse({ ...base, expects });
        const reparsed = OrbitalDefinitionSchema.parse(JSON.parse(JSON.stringify(parsed)));
        expect(reparsed.expects).toEqual(parsed.expects);
    });
    it('keeps strict on every declaration kind (spec obligations)', () => {
        const strictOnes = [
            { kind: 'identity', name: 'Customer', strict: true },
            { kind: 'entity', name: 'Order', strict: true },
            { kind: 'event', traitName: 'Checkout', event: 'ORDER_PLACED', strict: true },
            { kind: 'page', path: '/orders/:id', strict: true },
        ];
        const parsed = OrbitalDefinitionSchema.parse({ ...base, expects: strictOnes });
        expect(parsed.expects?.map((e) => e.strict)).toEqual([true, true, true, true]);
    });

    it('leaves strict absent on a hand-written declaration (control)', () => {
        const parsed = OrbitalDefinitionSchema.parse({ ...base, expects: [{ kind: 'entity', name: 'Order' }] });
        expect(parsed.expects?.[0] && 'strict' in parsed.expects[0]).toBe(false);
    });

    it('rejects a non-boolean strict', () => {
        expect(() =>
            OrbitalDefinitionSchema.parse({ ...base, expects: [{ kind: 'entity', name: 'Order', strict: 'yes' }] }),
        ).toThrow();
    });

    it('keeps spec on a spec orbital and writes no key on an ordinary one', () => {
        const spec = OrbitalDefinitionSchema.parse({ ...base, spec: true, expects: [{ kind: 'entity', name: 'Order', strict: true }] });
        expect(spec.spec).toBe(true);
        expect('spec' in OrbitalDefinitionSchema.parse(base)).toBe(false);
        expect(() => OrbitalDefinitionSchema.parse({ ...base, spec: 'yes' })).toThrow();
    });

    it('keeps an event expectation payload', () => {
        const parsed = OrbitalDefinitionSchema.parse({
            ...base,
            expects: [{ kind: 'event', traitName: 'Checkout', event: 'PLACED', payload: [{ name: 'orderId', type: 'string', required: true }] }],
        });
        expect(parsed.expects?.[0]).toMatchObject({ kind: 'event', payload: [{ name: 'orderId', type: 'string', required: true }] });
        expect(() =>
            OrbitalDefinitionSchema.parse({ ...base, expects: [{ kind: 'event', traitName: 'C', event: 'E', payload: [{ name: 'x' }] }] }),
        ).toThrow();
    });

    it('keeps what an entity expectation states about storage, marks and access', () => {
        const parsed = OrbitalDefinitionSchema.parse({
            ...base,
            expects: [{
                kind: 'entity', name: 'Order', persistence: 'persistent', shared: true,
                shape: [{ name: 'id', type: 'string', required: true, primaryKey: true }],
                read_policy: ['=', '@user.role', 'admin'],
                access_waivers: { update: 'visibility depends on another entity' },
            }],
        });
        expect(parsed.expects?.[0]).toMatchObject({ kind: 'entity', persistence: 'persistent', shared: true, access_waivers: { update: 'visibility depends on another entity' } });
        expect(() => OrbitalDefinitionSchema.parse({ ...base, expects: [{ kind: 'entity', name: 'O', persistence: 'forever' }] })).toThrow();
    });

    it('keeps the traits a page expectation mounts', () => {
        const parsed = OrbitalDefinitionSchema.parse({ ...base, expects: [{ kind: 'page', path: '/orders', traits: ['Checkout'] }] });
        expect(parsed.expects?.[0]).toMatchObject({ kind: 'page', traits: ['Checkout'] });
    });

    it('keeps state and transition expectations', () => {
        const parsed = OrbitalDefinitionSchema.parse({
            ...base,
            expects: [
                { kind: 'state', traitName: 'Checkout', state: 'paid' },
                { kind: 'transition', traitName: 'Checkout', from: 'idle', event: 'PAY', to: 'paid', strict: true },
            ],
        });
        expect(parsed.expects?.map((e) => e.kind)).toEqual(['state', 'transition']);
        expect(() => OrbitalDefinitionSchema.parse({ ...base, expects: [{ kind: 'transition', traitName: 'C', from: 'a', event: 'E' }] })).toThrow();
    });
});
