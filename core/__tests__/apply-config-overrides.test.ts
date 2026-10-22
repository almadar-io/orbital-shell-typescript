import { describe, expect, it } from 'vitest';

import { applyTraitConfigOverrides } from '../src/builders';
import { ConfigFieldDeclarationSchema } from '../src/types/trait.js';
import type { OrbitalSchema } from '../src/types/schema.js';

const SCHEMA: OrbitalSchema = {
    name: 'ui-health-bar',
    orbitals: [
        {
            name: 'HealthBarOrbital',
            entity: 'HealthBarItem',
            pages: [],
            traits: [
                {
                    name: 'HealthBarRender',
                    scope: 'instance',
                    config: {
                        current: { type: 'number', default: 0, label: 'Current', tier: 'presentation' },
                        max: { type: 'number', default: 0 },
                        format: {
                            type: 'string',
                            default: 'hearts',
                            label: 'Format',
                            tier: 'presentation',
                            values: ['hearts', 'bar', 'numeric'],
                        },
                    },
                },
            ],
        },
    ],
};

describe('applyTraitConfigOverrides', () => {
    it('patches the default of declared config fields on the matching trait', () => {
        const out = applyTraitConfigOverrides(SCHEMA, { HealthBarRender: { current: 72, format: 'bar' } });
        const trait = out.orbitals[0]?.traits[0];
        if (typeof trait !== 'object' || trait === null || !('scope' in trait) || trait.config === undefined) {
            throw new Error('expected an inlined trait with declared config');
        }
        const config = trait.config;
        expect(config.current?.default).toBe(72);
        expect(config.current?.label).toBe('Current'); // metadata preserved
        expect(config.format?.default).toBe('bar');
        expect(config.format?.values).toEqual(['hearts', 'bar', 'numeric']); // enum members preserved
        expect(config.max?.default).toBe(0); // untouched field
    });

    it('returns the same schema reference when there are no overrides', () => {
        expect(applyTraitConfigOverrides(SCHEMA, {})).toBe(SCHEMA);
    });

    it('ignores override fields not declared on the trait', () => {
        const out = applyTraitConfigOverrides(SCHEMA, { HealthBarRender: { nope: 5 } });
        const trait = out.orbitals[0]?.traits[0];
        if (typeof trait !== 'object' || trait === null || !('scope' in trait) || trait.config === undefined) {
            throw new Error('config');
        }
        expect('nope' in trait.config).toBe(false);
    });

    it('does not mutate the input schema', () => {
        const before = JSON.stringify(SCHEMA);
        applyTraitConfigOverrides(SCHEMA, { HealthBarRender: { current: 99 } });
        expect(JSON.stringify(SCHEMA)).toBe(before);
    });
});

describe('ConfigFieldDeclaration metadata round-trips through Zod', () => {
    it('preserves label/description/tier/values/synonyms', () => {
        const parsed = ConfigFieldDeclarationSchema.parse({
            type: 'string',
            default: 'hearts',
            label: 'Format',
            description: 'Display format',
            tier: 'presentation',
            values: ['hearts', 'bar', 'numeric'],
            synonyms: 'style, look',
        });
        expect(parsed.label).toBe('Format');
        expect(parsed.tier).toBe('presentation');
        expect(parsed.values).toEqual(['hearts', 'bar', 'numeric']);
        expect(parsed.synonyms).toBe('style, look');
    });

    it('preserves forwardedFrom on a collapsed knob forward', () => {
        const parsed = ConfigFieldDeclarationSchema.parse({
            type: 'number',
            default: 50,
            forwardedFrom: '@config.pageSize',
        });
        expect(parsed.forwardedFrom).toBe('@config.pageSize');
    });

    it('leaves forwardedFrom absent when not declared (no key invented)', () => {
        const parsed = ConfigFieldDeclarationSchema.parse({ type: 'number', default: 50 });
        expect('forwardedFrom' in parsed).toBe(false);
    });
});

describe('applyTraitConfigOverrides — default-less declarations on a trait reference', () => {
    it('keeps a default-less declaration a declaration and folds the override into it', () => {
        const schema: OrbitalSchema = {
            name: 'layout',
            orbitals: [
                {
                    name: 'LayoutOrbital',
                    entity: 'LayoutItem',
                    pages: [],
                    traits: [{ ref: 'Std.traits.AppLayout', name: 'AppLayout', config: { contentTrait: { type: 'trait', label: 'Content' }, sidebarTrait: { type: 'trait', label: 'Sidebar' } } }],
                },
            ],
        };
        const out = applyTraitConfigOverrides(schema, { AppLayout: { contentTrait: '@trait.Board' } });
        const trait = out.orbitals[0]?.traits[0];
        if (typeof trait !== 'object' || trait === null || 'scope' in trait) throw new Error('expected a trait reference');
        expect(trait.config?.['contentTrait']).toEqual({ type: 'trait', label: 'Content', default: '@trait.Board' });
        expect(trait.config?.['sidebarTrait']).toEqual({ type: 'trait', label: 'Sidebar' });
    });
});
