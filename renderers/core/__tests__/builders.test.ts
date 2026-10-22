import { describe, expect, it } from 'vitest';

import {
    makeAtomOrbital,
    makeOrbitalWithUses,
    makePageRef,
    makeTraitRef,
} from '../src/builders';

import type { Entity } from '../src/types/entity.js';

// ============================================================================
// Shared fixtures
// ============================================================================

/**
 * Minimal valid Entity used by makeAtomOrbital / makeOrbitalWithUses tests.
 */
const BROWSE_ENTITY: Entity = {
    name: 'BrowseItem',
    persistence: 'runtime',
    fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'label', type: 'string' },
    ],
};

// ============================================================================
// makeTraitRef
// ============================================================================

describe('makeTraitRef', () => {
    it('returns a minimal TraitReference with only ref set', () => {
        const result = makeTraitRef({ ref: 'Browse.traits.BrowseItemBrowse' });

        expect(result).toEqual({ ref: 'Browse.traits.BrowseItemBrowse' });
        // Optional fields must not be present (no `key: undefined` slots).
        expect('from' in result).toBe(false);
        expect('name' in result).toBe(false);
        expect('linkedEntity' in result).toBe(false);
        expect('events' in result).toBe(false);
        expect('effects' in result).toBe(false);
        expect('listens' in result).toBe(false);
        expect('emitsScope' in result).toBe(false);
        expect('config' in result).toBe(false);
    });

    it('propagates every optional override that is provided', () => {
        const result = makeTraitRef({
            from: 'std/behaviors/atoms/std-browse',
            ref: 'Browse.traits.BrowseItemBrowse',
            name: 'BrowseItemCustomBrowse',
            linkedEntity: 'BrowseItem',
            events: { BROWSE: 'LIST' },
            effects: {
                LIST: [['fetch', 'BrowseItem']],
            },
            listens: [
                { event: 'OtherTrait.REFRESH', triggers: 'LIST', scope: 'external' },
            ],
            emitsScope: 'external',
            config: { search: { placeholder: 'Search items' } },
        });

        expect(result.from).toBe('std/behaviors/atoms/std-browse');
        expect(result.ref).toBe('Browse.traits.BrowseItemBrowse');
        expect(result.name).toBe('BrowseItemCustomBrowse');
        expect(result.linkedEntity).toBe('BrowseItem');
        expect(result.events).toEqual({ BROWSE: 'LIST' });
        expect(result.effects).toEqual({ LIST: [['fetch', 'BrowseItem']] });
        expect(result.listens).toEqual([
            { event: 'OtherTrait.REFRESH', triggers: 'LIST', scope: 'external' },
        ]);
        expect(result.emitsScope).toBe('external');
        expect(result.config).toEqual({ search: { placeholder: 'Search items' } });
    });

    it('omits optional keys when passed undefined explicitly', () => {
        const result = makeTraitRef({
            ref: 'Browse.traits.BrowseItemBrowse',
            from: undefined,
            name: undefined,
            linkedEntity: undefined,
            events: undefined,
            effects: undefined,
            listens: undefined,
            emitsScope: undefined,
            config: undefined,
        });

        // Object should be structurally equal to the minimal shape.
        expect(result).toEqual({ ref: 'Browse.traits.BrowseItemBrowse' });
        expect(Object.keys(result)).toEqual(['ref']);
    });
});

// ============================================================================
// makePageRef
// ============================================================================

describe('makePageRef', () => {
    it('returns a minimal PageRefObject with only ref set', () => {
        const result = makePageRef({ ref: 'Browse.pages.BrowseItemPage' });

        expect(result).toEqual({ ref: 'Browse.pages.BrowseItemPage' });
        expect('from' in result).toBe(false);
        expect('path' in result).toBe(false);
        expect('linkedEntity' in result).toBe(false);
        expect('traits' in result).toBe(false);
    });

    it('propagates every optional override that is provided', () => {
        const result = makePageRef({
            from: 'std/behaviors/atoms/std-browse',
            ref: 'Browse.pages.BrowseItemPage',
            path: '/items',
            linkedEntity: 'BrowseItem',
            traits: [{ ref: 'Browse.traits.BrowseItemBrowse' }],
        });

        expect(result.from).toBe('std/behaviors/atoms/std-browse');
        expect(result.ref).toBe('Browse.pages.BrowseItemPage');
        expect(result.path).toBe('/items');
        expect(result.linkedEntity).toBe('BrowseItem');
        expect(result.traits).toEqual([{ ref: 'Browse.traits.BrowseItemBrowse' }]);
    });

    it('omits optional keys when passed undefined explicitly', () => {
        const result = makePageRef({
            ref: 'Browse.pages.BrowseItemPage',
            from: undefined,
            path: undefined,
            linkedEntity: undefined,
            traits: undefined,
        });

        expect(result).toEqual({ ref: 'Browse.pages.BrowseItemPage' });
        expect(Object.keys(result)).toEqual(['ref']);
    });
});

// ============================================================================
// makeOrbitalWithUses
// ============================================================================

describe('makeOrbitalWithUses', () => {
    it('carries the orbital\'s own config knobs verbatim; control: none declared adds no config key', () => {
        const base = {
            name: 'LandingPage',
            uses: [{ from: 'std/behaviors/atoms/std-browse', as: 'Browse' }],
            entity: BROWSE_ENTITY,
            traits: [{ ref: 'Browse.traits.BrowseItemBrowse' }],
        };
        const config = { heroTitle: { type: 'string', default: 'Made to last', label: 'Headline' } };
        expect(makeOrbitalWithUses({ ...base, config }).config).toEqual(config);
        expect('config' in makeOrbitalWithUses(base)).toBe(false);
    });

    it('returns an orbital with uses, entity, traits, and empty pages', () => {
        const result = makeOrbitalWithUses({
            name: 'BrowseItemOrbital',
            uses: [{ from: 'std/behaviors/atoms/std-browse', as: 'Browse' }],
            entity: BROWSE_ENTITY,
            traits: [{ ref: 'Browse.traits.BrowseItemBrowse' }],
        });

        expect(result.name).toBe('BrowseItemOrbital');
        expect(result.uses).toEqual([
            { from: 'std/behaviors/atoms/std-browse', as: 'Browse' },
        ]);
        expect(result.entity).toBe(BROWSE_ENTITY);
        expect(result.traits).toEqual([{ ref: 'Browse.traits.BrowseItemBrowse' }]);
        // When `pages` is omitted, the helper defaults to `[]` (so consumers that
        // iterate pages don't crash on undefined).
        expect(result.pages).toEqual([]);
    });

    it('propagates pages when provided', () => {
        const result = makeOrbitalWithUses({
            name: 'BrowseItemOrbital',
            uses: [{ from: 'std/behaviors/atoms/std-browse', as: 'Browse' }],
            entity: BROWSE_ENTITY,
            traits: [{ ref: 'Browse.traits.BrowseItemBrowse' }],
            pages: [{ ref: 'Browse.pages.BrowseItemPage', path: '/items' }],
        });

        expect(result.pages).toEqual([
            { ref: 'Browse.pages.BrowseItemPage', path: '/items' },
        ]);
    });

    it('threads auxiliaryEntities verbatim and omits the key when absent', () => {
        const aux: Entity = {
            name: 'MultiPartyView',
            persistence: 'runtime',
            fields: [{ name: 'errorMessage', type: 'string' }],
        };
        const withAux = makeOrbitalWithUses({
            name: 'MultiPartyTransactionOrbital',
            uses: [{ from: 'std/behaviors/atoms/std-browse', as: 'Browse' }],
            entity: BROWSE_ENTITY,
            auxiliaryEntities: [aux],
            traits: [{ ref: 'Browse.traits.BrowseItemBrowse' }],
        });
        expect(withAux.auxiliaryEntities).toEqual([aux]);

        const withoutAux = makeOrbitalWithUses({
            name: 'BrowseItemOrbital',
            uses: [{ from: 'std/behaviors/atoms/std-browse', as: 'Browse' }],
            entity: BROWSE_ENTITY,
            traits: [{ ref: 'Browse.traits.BrowseItemBrowse' }],
        });
        expect('auxiliaryEntities' in withoutAux).toBe(false);
    });

    it('supports entity references (call-form) as well as inline entities', () => {
        const result = makeOrbitalWithUses({
            name: 'CartItemOrbital',
            uses: [{ from: 'std/behaviors/atoms/std-modal', as: 'Modal' }],
            entity: {
                extends: 'Modal.entity',
                name: 'CartItem',
                fields: [{ name: 'pendingId', type: 'string' }],
            },
            traits: [{ ref: 'Modal.traits.ModalRecordModal' }],
        });

        expect(result.entity).toEqual({
            extends: 'Modal.entity',
            name: 'CartItem',
            fields: [{ name: 'pendingId', type: 'string' }],
        });
    });
});

// ============================================================================
// makeAtomOrbital
// ============================================================================

describe('makeAtomOrbital', () => {
    it('builds a single-atom orbital with just a trait ref (no page)', () => {
        const result = makeAtomOrbital({
            name: 'BrowseItemOrbital',
            atomPath: 'std/behaviors/atoms/std-browse',
            alias: 'Browse',
            entity: BROWSE_ENTITY,
            traitRef: 'Browse.traits.BrowseItemBrowse',
        });

        expect(result.name).toBe('BrowseItemOrbital');
        expect(result.uses).toEqual([
            { from: 'std/behaviors/atoms/std-browse', as: 'Browse' },
        ]);
        expect(result.entity).toBe(BROWSE_ENTITY);
        expect(result.traits).toHaveLength(1);

        const traitRef = result.traits[0];
        expect(traitRef).toEqual({
            ref: 'Browse.traits.BrowseItemBrowse',
            from: 'std/behaviors/atoms/std-browse',
            linkedEntity: 'BrowseItem',
        });

        // No pageRef provided => pages defaults to [] (not undefined).
        expect(result.pages).toEqual([]);
    });

    it('attaches a page ref when provided and threads the linkedEntity', () => {
        const result = makeAtomOrbital({
            name: 'BrowseItemOrbital',
            atomPath: 'std/behaviors/atoms/std-browse',
            alias: 'Browse',
            entity: BROWSE_ENTITY,
            traitRef: 'Browse.traits.BrowseItemBrowse',
            pageRef: 'Browse.pages.BrowseItemPage',
        });

        expect(result.pages).toEqual([
            {
                ref: 'Browse.pages.BrowseItemPage',
                from: 'std/behaviors/atoms/std-browse',
                linkedEntity: 'BrowseItem',
            },
        ]);
    });

    it('propagates traitOverrides and pageOverrides', () => {
        const result = makeAtomOrbital({
            name: 'BrowseItemOrbital',
            atomPath: 'std/behaviors/atoms/std-browse',
            alias: 'Browse',
            entity: BROWSE_ENTITY,
            traitRef: 'Browse.traits.BrowseItemBrowse',
            traitOverrides: {
                name: 'BrowseItemCustomBrowse',
                events: { BROWSE: 'LIST' },
                effects: { LIST: [['fetch', 'BrowseItem']] },
                listens: [
                    { event: 'Upstream.REFRESH', triggers: 'LIST', scope: 'external' },
                ],
                emitsScope: 'external',
                config: { search: { placeholder: 'Search' } },
            },
            pageRef: 'Browse.pages.BrowseItemPage',
            pageOverrides: { path: '/custom-items' },
        });

        const traitRef = result.traits[0];
        expect(traitRef).toEqual({
            ref: 'Browse.traits.BrowseItemBrowse',
            from: 'std/behaviors/atoms/std-browse',
            linkedEntity: 'BrowseItem',
            name: 'BrowseItemCustomBrowse',
            events: { BROWSE: 'LIST' },
            effects: { LIST: [['fetch', 'BrowseItem']] },
            listens: [
                { event: 'Upstream.REFRESH', triggers: 'LIST', scope: 'external' },
            ],
            emitsScope: 'external',
            config: { search: { placeholder: 'Search' } },
        });

        expect(result.pages).toEqual([
            {
                ref: 'Browse.pages.BrowseItemPage',
                from: 'std/behaviors/atoms/std-browse',
                linkedEntity: 'BrowseItem',
                path: '/custom-items',
            },
        ]);
    });

    it('omits absent trait/page override keys (no `key: undefined` slots)', () => {
        const result = makeAtomOrbital({
            name: 'BrowseItemOrbital',
            atomPath: 'std/behaviors/atoms/std-browse',
            alias: 'Browse',
            entity: BROWSE_ENTITY,
            traitRef: 'Browse.traits.BrowseItemBrowse',
            traitOverrides: {
                // All override slots are explicitly undefined — none should
                // end up on the emitted TraitReference.
                name: undefined,
                events: undefined,
                effects: undefined,
                listens: undefined,
                emitsScope: undefined,
                config: undefined,
            },
            pageRef: 'Browse.pages.BrowseItemPage',
            pageOverrides: { path: undefined },
        });

        const traitRef = result.traits[0];
        expect(Object.keys(traitRef).sort()).toEqual(
            ['from', 'linkedEntity', 'ref'].sort(),
        );

        const pageRef = result.pages[0];
        expect(Object.keys(pageRef).sort()).toEqual(
            ['from', 'linkedEntity', 'ref'].sort(),
        );
    });
});
