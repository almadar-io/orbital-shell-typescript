import { describe, it, expect } from 'vitest';
import {
    // Zod schemas
    TraitSchema,
    EntitySchema,
    OrbitalSchemaSchema,
    PageSchema,
    isRoutePage,
    protocolName,
    ProtocolSpecSchema,
    FieldSchema,
    StateMachineSchema,
    EffectSchema,
    SExprSchema,
    TraitRefSchema,
    TraitReferenceSchema,
    EntityCallSchema,
    ServiceRefObjectSchema,
    PageRefObjectSchema,

    // Parse functions
    parseOrbitalSchema,
    safeParseOrbitalSchema,

    // Type guards

    isSExpr,
    isBinding,
    isSExprCall,
    isInlineTrait,
    isServiceReferenceObject,
    getTraitName,
    normalizeTraitRef,

    // Resolver
    schemaToIR,
} from '../index';

// ============================================================================
// Shared fixtures
// ============================================================================

/** A minimal valid orbital for use in OrbitalSchemaSchema tests */
const VALID_ORBITAL = {
    name: 'UserOrbital',
    entity: { name: 'User', fields: [{ name: 'name', type: 'string' }] },
    traits: [{ name: 'user-lifecycle' }],
    pages: [{ name: 'UserList', path: '/users' }],
};

// ============================================================================
// Entity Schema
// ============================================================================

describe('EntitySchema', () => {
    it('parses a valid entity', () => {
        const entity = {
            name: 'User',
            fields: [
                { name: 'email', type: 'string', required: true },
                { name: 'age', type: 'number' },
            ],
        };
        const result = EntitySchema.safeParse(entity);
        expect(result.success).toBe(true);
    });

    it('rejects entity without name', () => {
        const entity = { fields: [{ name: 'email', type: 'string' }] };
        const result = EntitySchema.safeParse(entity);
        expect(result.success).toBe(false);
    });

    const program = (spec: boolean) => ({
        name: 'App',
        orbitals: [{ name: 'CollectorSpec', ...(spec ? { spec: true } : {}), entity: { name: 'CollectorSpec', fields: [] }, traits: [], pages: [] }],
    });

    it('a spec orbital (`expects` only) owns a shell entity with no fields, as orb lowers it and its validator skips it', () => {
        expect(OrbitalSchemaSchema.safeParse(program(true)).success).toBe(true);
    });

    it('control: any other orbital still needs at least one field', () => {
        const result = OrbitalSchemaSchema.safeParse(program(false));
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((i) => i.message)).toContain('At least one field is required');
    });

    it('control: rejects entity without a fields list', () => {
        const entity = { name: 'User' };
        const result = EntitySchema.safeParse(entity);
        expect(result.success).toBe(false);
    });
});

// ============================================================================
// FieldSchema
// ============================================================================

describe('FieldSchema', () => {
    it('parses all scalar field types without extra config', () => {
        // Enum excluded — requires `values` (see dedicated enum tests below).
        // Relation excluded — requires `relation` config.
        // Array excluded — requires `items` (see dedicated array tests below).
        const types = ['string', 'number', 'boolean', 'date', 'object', 'timestamp', 'datetime'];
        for (const type of types) {
            const result = FieldSchema.safeParse({ name: 'testField', type });
            expect(result.success, `type "${type}" should be valid`).toBe(true);
        }
    });

    it('parses enum fields with non-empty values', () => {
        const result = FieldSchema.safeParse({ name: 'status', type: 'enum', values: ['open', 'closed'] });
        expect(result.success).toBe(true);
    });

    it('rejects enum fields without values (GAP-AGB-9 regression guard)', () => {
        const bare = FieldSchema.safeParse({ name: 'status', type: 'enum' });
        expect(bare.success).toBe(false);

        const empty = FieldSchema.safeParse({ name: 'status', type: 'enum', values: [] });
        expect(empty.success).toBe(false);
    });

    it('rejects invalid field type', () => {
        const result = FieldSchema.safeParse({ name: 'testField', type: 'invalid' });
        expect(result.success).toBe(false);
    });

    // ------------------------------------------------------------------------
    // Phase 1.1 — array fields require `items`
    // ------------------------------------------------------------------------

    it('accepts array fields without an `items` schema (8.6.2 relaxation for std codegen)', () => {
        const result = FieldSchema.safeParse({ name: 'xs', type: 'array' });
        expect(result.success).toBe(true);
    });

    it('accepts array fields with an `items` schema', () => {
        const result = FieldSchema.safeParse({
            name: 'xs',
            type: 'array',
            items: { name: 'x', type: 'string' },
        });
        expect(result.success).toBe(true);
    });

    // ------------------------------------------------------------------------
    // Phase 1.1 — field-type alias normalization (text/int/float/ts)
    // ------------------------------------------------------------------------

    it('normalizes `text` alias to canonical `string`', () => {
        const result = FieldSchema.safeParse({ name: 'title', type: 'text' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('string');
        }
    });

    it('keeps `int` as its own field type (the Rust core writes it)', () => {
        const result = FieldSchema.safeParse({ name: 'count', type: 'int' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('int');
        }
    });

    it('normalizes `float` alias to canonical `number`', () => {
        const result = FieldSchema.safeParse({ name: 'price', type: 'float' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('number');
        }
    });

    it('normalizes `ts` alias to canonical `timestamp`', () => {
        const result = FieldSchema.safeParse({ name: 'created', type: 'ts' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('timestamp');
        }
    });

    it('leaves existing canonical types untouched after alias preprocess', () => {
        const plain = FieldSchema.safeParse({ name: 'title', type: 'string' });
        expect(plain.success).toBe(true);
        if (plain.success) {
            expect(plain.data.type).toBe('string');
        }

        const enumField = FieldSchema.safeParse({
            name: 'status',
            type: 'enum',
            values: ['open', 'closed'],
        });
        expect(enumField.success).toBe(true);

        const relationField = FieldSchema.safeParse({
            name: 'authorId',
            type: 'relation',
            relation: { entity: 'User', cardinality: 'one' },
        });
        expect(relationField.success).toBe(true);
    });
});

// ============================================================================
// StateMachineSchema
// ============================================================================

describe('StateMachineSchema', () => {
    it('parses a valid state machine', () => {
        const sm = {
            states: [{ name: 'idle' }, { name: 'active' }],
            events: [{ key: 'START', name: 'Start' }],
            transitions: [{ from: 'idle', event: 'START', to: 'active' }],
        };
        const result = StateMachineSchema.safeParse(sm);
        expect(result.success).toBe(true);
    });

    it('rejects state machine with no states', () => {
        const sm = {
            states: [],
            events: [{ key: 'X', name: 'X' }],
            transitions: [],
        };
        const result = StateMachineSchema.safeParse(sm);
        expect(result.success).toBe(false);
    });
});

// ============================================================================
// TraitSchema
// ============================================================================

describe('TraitSchema', () => {
    it('parses a minimal trait', () => {
        const trait = { name: 'my-trait' };
        const result = TraitSchema.safeParse(trait);
        expect(result.success).toBe(true);
    });

    it('parses a trait with full state machine', () => {
        const trait = {
            name: 'lifecycle',
            linkedEntity: 'User',
            stateMachine: {
                states: [{ name: 'idle' }, { name: 'loading' }],
                events: [{ key: 'FETCH', name: 'Fetch' }],
                transitions: [
                    {
                        from: 'idle',
                        event: 'FETCH',
                        to: 'loading',
                        effects: [['set', '@state.loading', true]],
                    },
                ],
            },
            emits: [{ event: 'DATA_LOADED', scope: 'external' }],
            listens: [{ event: 'REFRESH', triggers: 'FETCH' }],
        };
        const result = TraitSchema.safeParse(trait);
        expect(result.success).toBe(true);
    });

    it('rejects trait without name', () => {
        const result = TraitSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('keeps the dispatch mode', () => {
        for (const dispatch of ['client', 'optimistic', 'server'] as const) {
            const result = TraitSchema.safeParse({ name: 'T', dispatch });
            expect(result.success && result.data.dispatch).toBe(dispatch);
        }
    });

    it('control: an undeclared dispatch stays absent (server)', () => {
        const result = TraitSchema.safeParse({ name: 'T' });
        expect(result.success && result.data.dispatch).toBeUndefined();
    });

    it('rejects a retired dispatch spelling', () => {
        expect(TraitSchema.safeParse({ name: 'T', dispatch: 'persistedAwaited' }).success).toBe(false);
    });
});

// ============================================================================
// TraitRef variants
// ============================================================================

describe('TraitRefSchema', () => {
    it('accepts a string ref', () => {
        expect(TraitRefSchema.safeParse('ListBehavior').success).toBe(true);
    });

    it('accepts an object ref', () => {
        expect(TraitRefSchema.safeParse({ ref: 'ListBehavior' }).success).toBe(true);
    });

    it('accepts an inline trait', () => {
        expect(TraitRefSchema.safeParse({ name: 'inline-trait' }).success).toBe(true);
    });

    it('rejects empty string', () => {
        expect(TraitRefSchema.safeParse('').success).toBe(false);
    });
});

// ============================================================================
// Trait helpers
// ============================================================================

describe('Trait helpers', () => {
    it('isInlineTrait identifies inline traits', () => {
        expect(isInlineTrait({ name: 'my-trait' })).toBe(true);
        expect(isInlineTrait({ ref: 'my-trait' })).toBe(false);
        expect(isInlineTrait('my-trait')).toBe(false);
    });

    it('getTraitName extracts name from all ref forms', () => {
        expect(getTraitName('ListBehavior')).toBe('ListBehavior');
        expect(getTraitName({ ref: 'ListBehavior' })).toBe('ListBehavior');
        expect(getTraitName({ name: 'InlineTrait' })).toBe('InlineTrait');
    });

    it('normalizeTraitRef converts all forms to object', () => {
        expect(normalizeTraitRef('List')).toEqual({ ref: 'List' });
        expect(normalizeTraitRef({ ref: 'List', config: { x: 1 } })).toEqual({ ref: 'List', config: { x: 1 } });
        expect(normalizeTraitRef({ name: 'Inline' })).toEqual({ ref: 'Inline' });
    });
});

// ============================================================================
// EffectSchema
// ============================================================================

describe('EffectSchema', () => {
    it('parses S-expression effects', () => {
        const effects = [
            ['set', '@state.loading', true],
            ['emit', 'DATA_LOADED'],
            ['navigate', '/home'],
        ];
        for (const effect of effects) {
            const result = EffectSchema.safeParse(effect);
            expect(result.success, `effect ${JSON.stringify(effect)} should be valid`).toBe(true);
        }
    });
});

// ============================================================================
// SExpr and expression type guards
// ============================================================================

describe('S-Expression type guards', () => {
    it('isSExpr identifies arrays', () => {
        expect(isSExpr(['add', 1, 2])).toBe(true);
        expect(isSExpr('not-an-sexpr')).toBe(false);
        expect(isSExpr(42)).toBe(false);
    });

    it('isBinding identifies @ bindings', () => {
        expect(isBinding('@state.count')).toBe(true);
        expect(isBinding('@entity.name')).toBe(true);
        expect(isBinding('not-a-binding')).toBe(false);
    });

    it('isSExprCall identifies function calls', () => {
        expect(isSExprCall(['add', 1, 2])).toBe(true);
        expect(isSExprCall([1, 2, 3])).toBe(false);
    });
});

// ============================================================================
// OrbitalSchema (top-level app definition)
// ============================================================================

describe('OrbitalSchemaSchema', () => {
    it('parses a minimal app schema', () => {
        const schema = {
            name: 'my-app',
            orbitals: [VALID_ORBITAL],
        };
        const result = OrbitalSchemaSchema.safeParse(schema);
        expect(result.success).toBe(true);
    });

    it('rejects schema with empty orbitals', () => {
        const result = safeParseOrbitalSchema({ name: 'empty', orbitals: [] });
        expect(result.success).toBe(false);
    });

    it('safeParseOrbitalSchema returns error for invalid input', () => {
        const result = safeParseOrbitalSchema({});
        expect(result.success).toBe(false);
    });
});

// ============================================================================
// PageSchema
// ============================================================================

describe('PageSchema', () => {
    it('parses a valid page with minimal fields', () => {
        const page = {
            name: 'Dashboard',
            path: '/dashboard',
        };
        const result = PageSchema.safeParse(page);
        expect(result.success).toBe(true);
    });

    it('parses a page with viewType and traits', () => {
        const page = {
            name: 'Tasks',
            path: '/tasks',
            viewType: 'list',
            traits: [{ ref: 'ListBehavior' }],
        };
        const result = PageSchema.safeParse(page);
        expect(result.success).toBe(true);
    });

    it('rejects page with unknown keys', () => {
        const page = {
            name: 'Broken',
            path: '/broken',
            sections: [{ title: 'should fail' }], // strict rejects this
        };
        const result = PageSchema.safeParse(page);
        expect(result.success).toBe(false);
    });

    it('parses a protocol page with an empty path and an address', () => {
        const page = {
            name: 'Api',
            path: '',
            protocol: 'http',
            address: ['object', ['host', '@config.host'], ['port', 8080]],
            traits: [{ ref: 'Http1' }],
        };
        const result = PageSchema.safeParse(page);
        expect(result.success).toBe(true);
        expect(isRoutePage(page)).toBe(false);
        expect(protocolName(page)).toBe('http');
    });

    it('parses a protocol page with no address', () => {
        expect(PageSchema.safeParse({ name: 'Mcp', path: '', protocol: 'stdio' }).success).toBe(true);
    });

    it('control: a route page is a route and has no protocol', () => {
        const page = { name: 'Dash', path: '/dash' };
        expect(isRoutePage(page)).toBe(true);
        expect(protocolName(page)).toBe('route');
    });

    it('rejects a protocol page that also carries a route path', () => {
        expect(PageSchema.safeParse({ name: 'Api', path: '/x', protocol: 'http' }).success).toBe(false);
    });

    it('rejects a route page with an empty path, a bad path, or an address', () => {
        expect(PageSchema.safeParse({ name: 'A', path: '' }).success).toBe(false);
        expect(PageSchema.safeParse({ name: 'A', path: 'dash' }).success).toBe(false);
        expect(PageSchema.safeParse({ name: 'A', path: '/a', address: ['object'] }).success).toBe(false);
    });
});

describe('ProtocolSpecSchema', () => {
    it('reads a protocol table row', () => {
        const row = { name: 'http', address: [{ name: 'host', ty: 'string', required: true }], viewer: false, grant: 'NetListen', side: 'server' };
        expect(ProtocolSpecSchema.safeParse(row).success).toBe(true);
    });

    it('rejects an unknown side', () => {
        expect(ProtocolSpecSchema.safeParse({ name: 'x', viewer: false, side: 'cloud' }).success).toBe(false);
    });
});



// ============================================================================
// Schema resolver
// ============================================================================

describe('schemaToIR', () => {
    it('resolves a minimal schema to IR', () => {
        const schema = parseOrbitalSchema({
            name: 'test-app',
            orbitals: [VALID_ORBITAL],
        });
        const ir = schemaToIR(schema);
        expect(ir).toBeDefined();
    });
});

// ============================================================================
// Phase 3.5.G.F.4 — Reference type refines and ServiceRefObject guard
// ============================================================================

describe('Phase F.4 — TraitReferenceSchema.events refine', () => {
    it('accepts a well-formed events override', () => {
        const ok = TraitReferenceSchema.safeParse({
            ref: 'Modal.traits.ModalRecordModal',
            linkedEntity: 'CartItem',
            name: 'CartItemAddItem',
            events: { OPEN: 'ADD_ITEM', CLOSE: 'CANCEL_ADD' },
        });
        expect(ok.success).toBe(true);
    });

    it('rejects an empty event-key string in `events`', () => {
        const bad = TraitReferenceSchema.safeParse({
            ref: 'Modal.traits.ModalRecordModal',
            events: { '': 'ADD_ITEM' },
        });
        expect(bad.success).toBe(false);
    });

    it('rejects an empty event-value string in `events`', () => {
        const bad = TraitReferenceSchema.safeParse({
            ref: 'Modal.traits.ModalRecordModal',
            events: { OPEN: '' },
        });
        expect(bad.success).toBe(false);
    });

    it('accepts the same event override on the TraitRefSchema union variant', () => {
        const ok = TraitRefSchema.safeParse({
            ref: 'Modal.traits.ModalRecordModal',
            events: { OPEN: 'ADD_ITEM' },
        });
        expect(ok.success).toBe(true);
    });

    it('rejects empty event-key on the TraitRefSchema union variant', () => {
        const bad = TraitRefSchema.safeParse({
            ref: 'Modal.traits.ModalRecordModal',
            events: { OPEN: '' },
        });
        expect(bad.success).toBe(false);
    });
});

describe('Phase F.4 — EntityCallSchema.fields dedup refine', () => {
    it('accepts an EntityCall with distinct field names', () => {
        const ok = EntityCallSchema.safeParse({
            extends: 'Modal.entity',
            name: 'CartItem',
            fields: [
                { name: 'pendingId', type: 'string' },
                { name: 'lineItemCount', type: 'number' },
            ],
        });
        expect(ok.success).toBe(true);
    });

    it('accepts an EntityCall with no fields override at all', () => {
        const ok = EntityCallSchema.safeParse({
            extends: 'Modal.entity',
            name: 'CartItem',
        });
        expect(ok.success).toBe(true);
    });

    it('rejects an EntityCall with duplicate field names', () => {
        const bad = EntityCallSchema.safeParse({
            extends: 'Modal.entity',
            name: 'CartItem',
            fields: [
                { name: 'pendingId', type: 'string' },
                { name: 'pendingId', type: 'number' },
            ],
        });
        expect(bad.success).toBe(false);
    });
});

describe('Phase F.4 — ServiceRefObject schema and guard', () => {
    it('accepts a well-formed ServiceRefObject', () => {
        const ok = ServiceRefObjectSchema.safeParse({
            ref: 'Weather.services.openweather',
            baseUrl: 'https://staging.weather.example.com',
            headers: { 'X-Tenant': 'acme' },
        });
        expect(ok.success).toBe(true);
    });

    it('rejects a ServiceRefObject with a malformed ref', () => {
        const bad = ServiceRefObjectSchema.safeParse({
            ref: 'lowercase.bad.format',
        });
        expect(bad.success).toBe(false);
    });

    it('rejects a ServiceRefObject with an invalid baseUrl', () => {
        const bad = ServiceRefObjectSchema.safeParse({
            ref: 'Weather.services.openweather',
            baseUrl: 'not-a-url',
        });
        expect(bad.success).toBe(false);
    });

    it('isServiceReferenceObject returns true for the object form', () => {
        expect(
            isServiceReferenceObject({ ref: 'Weather.services.openweather' }),
        ).toBe(true);
    });

    it('isServiceReferenceObject returns false for a bare string ref', () => {
        expect(isServiceReferenceObject('Weather.services.openweather')).toBe(false);
    });

    it('isServiceReferenceObject returns false for an inline ServiceDefinition', () => {
        expect(
            isServiceReferenceObject({
                name: 'openweather',
                type: 'rest',
                baseUrl: 'https://api.example.com',
            } as never),
        ).toBe(false);
    });
});

// ============================================================================
// Phase 1.2 — Optional `from` disambiguator on TraitReference and PageRefObject
// ============================================================================

describe('Phase 1.2 — TraitReferenceSchema.from', () => {
    it('accepts a TraitReference without `from` (undefined preserved)', () => {
        const result = TraitReferenceSchema.safeParse({
            ref: 'Alias.traits.X',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.from).toBeUndefined();
        }
    });

    it('accepts a TraitReference with `from` and preserves the value', () => {
        const result = TraitReferenceSchema.safeParse({
            ref: 'Alias.traits.X',
            from: 'std/behaviors/atoms/std-browse',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.from).toBe('std/behaviors/atoms/std-browse');
        }
    });

    it('rejects a non-string `from` value', () => {
        const result = TraitReferenceSchema.safeParse({
            ref: 'X',
            from: 123,
        });
        expect(result.success).toBe(false);
    });
});

describe('Phase 1.2 — PageRefObjectSchema.from', () => {
    it('accepts a PageRefObject without `from` (undefined preserved)', () => {
        const result = PageRefObjectSchema.safeParse({
            ref: 'Alias.pages.X',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.from).toBeUndefined();
        }
    });

    it('accepts a PageRefObject with `from` and preserves the value', () => {
        const result = PageRefObjectSchema.safeParse({
            ref: 'Alias.pages.X',
            from: 'std/behaviors/atoms/std-browse',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.from).toBe('std/behaviors/atoms/std-browse');
        }
    });

    it('rejects a non-string `from` value', () => {
        const result = PageRefObjectSchema.safeParse({
            ref: 'Alias.pages.X',
            from: 123,
        });
        expect(result.success).toBe(false);
    });
});
