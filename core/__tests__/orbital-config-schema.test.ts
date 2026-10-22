import { describe, expect, it } from 'vitest';

import {
    OrbitalDefinitionSchema,
    UseDeclarationSchema,
    OrbitalRefObjectSchema,
    PageRefObjectSchema,
    parseOrbitalRef,
} from '../src/types/orbital.js';
import { OrbitalSchemaSchema } from '../src/types/schema.js';

/**
 * `z.object()` STRIPS unknown keys rather than rejecting them (the trap
 * documented in schema.ts), so `config`/`reference` must exist on BOTH the
 * type and the zod schema on all three new wire sites (root/orbital/use) or
 * they silently vanish on the interpreter path. Same pattern as
 * expects-declaration.test.ts / identity-entity-tag.test.ts.
 */

const declaredConfig = {
    appName: { type: 'string', default: 'Time', label: 'Shell title', tier: 'presentation' },
    pageSize: { type: 'number', default: 50 },
};

const baseOrbital = {
    name: 'NoteOrbital',
    entity: { name: 'Note', fields: [{ name: 'id', type: 'string', required: true }] },
    traits: [],
    pages: [],
};

describe('OrbitalSchemaSchema.config (organism-level declared knobs)', () => {
    it.each(['EventAddress', 'event', 'string'])('round-trips nested tool input type %s', (type) => {
        const tools = {
            type: '[AgentTool]',
            default: [{ event: 'Tasks.Persistor.CREATE' }],
            items: {
                type: 'union',
                values: ['AgentToolInput'],
                properties: {
                    AgentToolInput: {
                        name: 'AgentToolInput',
                        type: 'object',
                        properties: { event: { name: 'event', type, required: true } },
                    },
                },
            },
        };
        const parsed = OrbitalSchemaSchema.parse({
            name: 'assistant', orbitals: [{ ...baseOrbital, config: { tools } }],
        });
        expect(parsed.orbitals[0].config?.tools).toEqual(tools);
    });

    it('rejects an unsupported nested tool field type', () => {
        const result = OrbitalSchemaSchema.safeParse({
            name: 'assistant', orbitals: [baseOrbital],
            config: { tool: { type: 'object', properties: { event: { name: 'event', type: 'InvalidAddressType' } } } },
        });
        expect(result.success).toBe(false);
    });

    it('round-trips a declared config block', () => {
        const input = {
            name: 'std-notes',
            orbitals: [baseOrbital],
            config: declaredConfig,
        };
        const parsed = OrbitalSchemaSchema.parse(input);
        expect(parsed.config).toEqual(declaredConfig);
    });

    it('leaves config absent when not declared (no key invented)', () => {
        const parsed = OrbitalSchemaSchema.parse({ name: 'std-notes', orbitals: [baseOrbital] });
        expect('config' in parsed).toBe(false);
    });
});

describe('OrbitalDefinitionSchema.config (this orbital\'s own declared knobs)', () => {
    it('round-trips a declared config block', () => {
        const parsed = OrbitalDefinitionSchema.parse({ ...baseOrbital, config: declaredConfig });
        expect(parsed.config).toEqual(declaredConfig);
    });
});

describe('OrbitalDefinitionSchema.reference (transient import marker)', () => {
    const reference = {
        ref: 'TimeTracking.orbitals.TimesheetPanelOrbital',
        entity: 'Timesheet',
        fields: { up: 'local' },
        pages: { '/timesheets': '/pf-timesheets' },
        omit: ['TimesheetDelete'],
        only: ['TimesheetBrowseList'],
        config: declaredConfig,
        events: { UP: 'LOCAL' },
    };

    it('round-trips every field of a reference-form orbital', () => {
        const parsed = OrbitalDefinitionSchema.parse({
            name: 'PfTimesheets',
            // Rust lowers a reference-form orbital's placeholder entity as
            // EntityRef::Reference("<Alias>.orbitals.<Y>.entity"); JS's
            // EntityRefStringSchema only accepts "Alias.entity" — any valid
            // entity ref satisfies this test's purpose (round-tripping `reference`).
            entity: 'TimeTracking.entity',
            traits: [],
            pages: [],
            reference,
        });
        expect(parsed.reference).toEqual(reference);
    });

    it('leaves reference absent when not declared (no key invented)', () => {
        const parsed = OrbitalDefinitionSchema.parse(baseOrbital);
        expect('reference' in parsed).toBe(false);
    });
});

describe('UseDeclarationSchema.config (uses … { config } override)', () => {
    it('round-trips a config override', () => {
        const input = { from: 'almadar-behaviors/std-time-tracking', as: 'TT', config: declaredConfig };
        const parsed = UseDeclarationSchema.parse(input);
        expect(parsed.config).toEqual(declaredConfig);
    });

    it('leaves config absent when not declared (no key invented)', () => {
        const parsed = UseDeclarationSchema.parse({ from: 'std/behaviors/game-core', as: 'GameCore' });
        expect('config' in parsed).toBe(false);
    });
});

describe('OrbitalRefObjectSchema', () => {
    const full = {
        ref: 'TimeTracking.orbitals.TimesheetPanelOrbital',
        refId: 'orb_00000000000000000000000000',
        entity: 'Timesheet',
        fields: { up: 'local' },
        pages: { '/up': '/local' },
        omit: ['A', 'B'],
        only: ['C'],
        config: declaredConfig,
        events: { UP: 'LOCAL' },
        roles: { approver: ['owner', 'project_manager'], employee: ['team_member'] },
        entities: { Employee: 'Person' },
        mounts: { '/up': ['TraitA', 'TraitB'] },
    };

    it('round-trips every field', () => {
        const parsed = OrbitalRefObjectSchema.parse(full);
        expect(parsed).toEqual(full);
    });

    it('keeps an import mock override; control: a non-string sample list is refused', () => {
        const withMock = { ref: 'Identity.orbitals.IdentityOrbital', mock: { role: 'customer, staff' } };
        expect(OrbitalRefObjectSchema.parse(withMock)).toEqual(withMock);
        expect(() => OrbitalRefObjectSchema.parse({ ...withMock, mock: { role: 3 } })).toThrow();
    });

    it('rejects a malformed ref string', () => {
        expect(() =>
            OrbitalRefObjectSchema.parse({ ref: 'timeTracking.orbitals.TimesheetPanelOrbital' }),
        ).toThrow();
        expect(() =>
            OrbitalRefObjectSchema.parse({ ref: 'TimeTracking.traits.TimesheetPanel' }),
        ).toThrow();
    });

    it('rejects a malformed refId (wrong id-kind prefix)', () => {
        expect(() =>
            OrbitalRefObjectSchema.parse({
                ref: 'TimeTracking.orbitals.TimesheetPanelOrbital',
                refId: 'ent_00000000000000000000000000',
            }),
        ).toThrow();
    });

    it('THE TRAP: an unknown key is silently stripped, not rejected', () => {
        const withBogusKey = { ...full, bogusUnknownField: 'still parses' };
        const parsed = OrbitalRefObjectSchema.parse(withBogusKey);
        expect('bogusUnknownField' in parsed).toBe(false);
        // Every OTHER field must have survived — this is why roles/entities/mounts
        // had to be declared in the zod schema, not just the TS type.
        expect(parsed.roles).toEqual(full.roles);
        expect(parsed.entities).toEqual(full.entities);
        expect(parsed.mounts).toEqual(full.mounts);
    });

    it('accepts a single-target roles list (still an array on the wire)', () => {
        const parsed = OrbitalRefObjectSchema.parse({
            ref: 'TimeTracking.orbitals.TimesheetPanelOrbital',
            roles: { employee: ['team_member'] },
        });
        expect(parsed.roles).toEqual({ employee: ['team_member'] });
    });

    it('leaves roles/entities/mounts absent when not declared (no key invented)', () => {
        const parsed = OrbitalRefObjectSchema.parse({
            ref: 'TimeTracking.orbitals.TimesheetPanelOrbital',
        });
        expect('roles' in parsed).toBe(false);
        expect('entities' in parsed).toBe(false);
        expect('mounts' in parsed).toBe(false);
    });
});

describe('PageRefObjectSchema.linkedEntity / .traits (Phase F rebind)', () => {
    it('round-trips linkedEntity and a trait-ref list', () => {
        const input = {
            ref: 'User.pages.Profile',
            linkedEntity: 'Person',
            traits: ['Alias.traits.ProfileForm'],
        };
        const parsed = PageRefObjectSchema.parse(input);
        expect(parsed).toEqual(input);
    });

    it('leaves linkedEntity/traits absent when not declared (no key invented)', () => {
        const parsed = PageRefObjectSchema.parse({ ref: 'User.pages.Profile' });
        expect('linkedEntity' in parsed).toBe(false);
        expect('traits' in parsed).toBe(false);
    });
});

describe('parseOrbitalRef', () => {
    it('parses "Alias.orbitals.OrbitalName"', () => {
        expect(parseOrbitalRef('TimeTracking.orbitals.TimesheetPanelOrbital')).toEqual({
            alias: 'TimeTracking',
            orbitalName: 'TimesheetPanelOrbital',
        });
    });

    it('returns null for a trait reference', () => {
        expect(parseOrbitalRef('TimeTracking.traits.X')).toBeNull();
    });
});

describe('the legacy OrbitalConfig {theme,features,api} shape no longer parses (fails: DeclaredTraitConfig requires each entry to have a "type")', () => {
    it('rejects config.theme.primary — ConfigFieldDeclaration.type is a required string', () => {
        const legacy = {
            name: 'legacy-app',
            orbitals: [baseOrbital],
            config: { theme: { primary: 'blue' } },
        };
        const result = OrbitalSchemaSchema.safeParse(legacy);
        expect(result.success).toBe(false);
    });
});
