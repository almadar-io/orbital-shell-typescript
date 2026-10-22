/**
 * Field Types for Orbital Units
 *
 * Extracted from schema/data-entities.ts for the orbitals module.
 * These types define the field structure within orbital entities.
 *
 * @packageDocumentation
 */

import { FieldProjectionSchema, type FieldProjection } from './projection.js';
import { z } from 'zod';
import type { EntityId } from './identity.js';
import { EntityIdSchema } from './identity.js';
import type { JsonValue, RuntimeValue } from './json.js';
import { JsonValueSchema } from './json.js';

// ============================================================================
// Field Types
// ============================================================================

/**
 * Supported field types for entity fields.
 *
 * @example
 * { name: 'status', type: 'enum', values: ['draft', 'published'] }
 * { name: 'authorId', type: 'relation', relation: { entity: 'User', cardinality: 'one' } }
 */
export type FieldType = FieldTag | TypeVariable;

/** An unbound type variable (`t` of `type Page t` or a trait's `(t : Type)`),
 *  written `$t` — the `.orb` spelling the Rust `FieldType::TypeVar` serializes to. */
export type TypeVariable = `$${string}`;

/** The concrete field-type tags (every `FieldType` but a type variable). */
export type FieldTag =
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'timestamp'
    | 'datetime'
    // Semantic string domains. `.lolo` already types `date`/`datetime` rather
    // than annotating them, so these belong in the type system for the same
    // reason: a field's domain is a declared fact, not a decoration. They
    // replaced the optional `format` property, which had zero producers.
    | 'email'
    | 'url'
    | 'phone'
    | 'uuid'
    | 'image'
    // Promoted value types (2026-08-20). `money` is numeric at rest - the
    // declared type (never a field-name heuristic) drives currency inputs
    // and formatting. `file` is the canonical struct value
    // {name, url, mimeType, sizeBytes} - an uploaded artifact, not a
    // validated string; `url` is a data: URI in mock mode.
    | 'money'
    | 'file'
    // `bytes` is binary data; at rest a standard padded base64 string.
    | 'bytes'
    | 'array'
    | 'object'
    | 'enum'
    | 'relation'
    | 'trait'
    | 'orbital'
    | 'behavior'
    | 'slot'
    | 'pattern'
    // Renderable UI content — a pattern node (or array of them), the same
    // shape `render-ui` effects carry (`PatternNode` in render-ui-edit.ts).
    // First-class so view-fragment fields stop hiding behind `object`/`json`.
    | 'node'
    // Event-name reference — a string at rest, but the TYPE marks it as an
    // event key rather than free text (Phase B / SCAN-EVENT-KNOB-2). Legal
    // on struct-alias fields consumed by config knobs (e.g. `ItemAction.event`).
    | 'event'
    // A value addressing a declared external input (`Trait.EVENT`,
    // `Orbital.Trait.EVENT`) — never a bare name. See `EventAddress` in access/externalInputs.
    | 'EventAddress'
    // A call key — a string at rest, but nominal: a bare string never converts to it
    // implicitly, only `(as v CallKey)` does. Names the keyed call a `cancel-call` aborts.
    | 'CallKey'
    // An S-expression as data — atom, list or options object (a transition's
    // guard / effect args); config-only (G-ORB-093).
    | 'SExpr'
    // Tagged struct union (`type DrawItem = DrawShape | DrawText`) — a real
    // .lolo/.orb type the Rust compiler accepts; the TS mirror must carry it
    // or generated factories fail DTS (docs/Almadar_LOLO_Gaps.md L-6).
    | 'union'
    // Fixed-length tuple (`.lolo` `[T1, T2, …]`); slots ride `properties`, keyed by index.
    | 'tuple';

/** Every `FieldType`, as a runtime array. Downstream imports this instead of
 *  re-listing the union — five copies had already drifted apart. */
export const FIELD_TYPES = [
    'string',
    'number',
    'boolean',
    'date',
    'timestamp',
    'datetime',
    'email',
    'url',
    'phone',
    'uuid',
    'image',
    'money',
    'file',
    'bytes',
    'array',
    'object',
    'enum',
    'relation',
    'trait',
    'orbital',
    'behavior',
    'slot',
    'pattern',
    'node',
    'event',
    'EventAddress',
    'CallKey',
    'SExpr',
    'union',
    'tuple',
] as const satisfies readonly FieldTag[];

/** The semantic string domains — constrained strings, validatable by value. */
export const SEMANTIC_STRING_TYPES = ['email', 'url', 'phone', 'uuid', 'image'] as const;

export type SemanticStringType = (typeof SEMANTIC_STRING_TYPES)[number];

/** Is this a semantic string domain (as opposed to a bare `string`)? */
export function isSemanticStringType(type: FieldType): type is SemanticStringType {
    return (SEMANTIC_STRING_TYPES as readonly string[]).includes(type);
}

export const FieldTagSchema = z.enum(FIELD_TYPES);

export function isTypeVariable(type: string): type is TypeVariable {
    return /^\$.+$/.test(type);
}

export const TypeVariableSchema = z.custom<TypeVariable>(
    (v) => typeof v === 'string' && isTypeVariable(v),
    { message: 'a type variable is `$<name>`' },
);

export const FieldTypeSchema = z.union([FieldTagSchema, TypeVariableSchema]);

/** Words legal in a `.lolo`/`.orb` TYPE POSITION that are not entity field
 *  types (config/param/return annotations, primitives with no field-level
 *  meaning, etc.) — declared so the i18n `types` vocabulary section is
 *  `FIELD_TYPES ∪ TYPE_POSITION_ONLY` exactly, not a hand-maintained superset
 *  held together by a one-directional pinned test (see G-i18n-5). */
export const TYPE_POSITION_ONLY = [
    'Map',
    'any',
    'asset',
    'bool',
    'component',
    'duration',
    'entity',
    'float',
    'icon',
    'int',
    'null',
    'secret',
    'void',
] as const;

// ============================================================================
// Relation Configuration
// ============================================================================

/**
 * Cardinality for relation fields.
 * Matches Rust compiler's Cardinality enum.
 */
export type RelationCardinality = 
    | 'one' 
    | 'many' 
    | 'one-to-many' 
    | 'many-to-one' 
    | 'many-to-many';

export const RelationCardinalitySchema = z.enum([
    'one',
    'many',
    'one-to-many',
    'many-to-one',
    'many-to-many',
]);

/**
 * Configuration for relation fields (foreign keys).
 * Matches Rust compiler's RelationDefinition format.
 */
export type RelationConfig = {
    /** Target entity name (e.g., 'User', 'Task') - matches Rust's `entity` field */
    entity: string;
    /** V4 dual-carry id sibling of `entity` — optional until the Phase-7 flip. */
    entityId?: EntityId;
    /** Field on target entity (defaults to 'id') */
    field?: string;
    /** 
     * Cardinality: one, many, one-to-many, many-to-one, many-to-many
     * Matches Rust compiler's cardinality format
     */
    cardinality?: RelationCardinality;
    /** Delete behavior */
    onDelete?: 'cascade' | 'nullify' | 'restrict';
    /** 
     * Foreign key field name (for legacy compatibility).
     * @deprecated Use field instead
     */
    foreignKey?: string;
    /**
     * Target entity name (for legacy compatibility).
     * @deprecated Use entity instead
     */
    target?: string;
    /**
     * Cardinality type alias (for legacy compatibility).
     * @deprecated Use cardinality instead
     */
    type?: RelationCardinality;
};

export const RelationConfigSchema = z.object({
    entity: z.string().min(1, 'Target entity is required'),
    entityId: EntityIdSchema.optional(),
    field: z.string().optional(),
    cardinality: RelationCardinalitySchema.optional(),
    onDelete: z.enum(['cascade', 'nullify', 'restrict']).optional(),
    // Legacy compatibility fields
    foreignKey: z.string().optional(),
    target: z.string().optional(),
    type: RelationCardinalitySchema.optional(),
}).transform((data) => {
    // Normalize legacy format to standard format
    const cardinality = data.cardinality || data.type;
    const normalized: RelationConfig = {
        entity: data.entity || data.target || '',
        ...(data.entityId !== undefined ? { entityId: data.entityId } : {}),
        ...(cardinality !== undefined ? { cardinality } : {}),
        ...(data.field !== undefined ? { field: data.field } : {}),
        ...(data.onDelete !== undefined ? { onDelete: data.onDelete } : {}),
    };
    return normalized;
});

export type RelationConfigInput = z.input<typeof RelationConfigSchema>;

// ============================================================================
// Field Format
// ============================================================================

/**
 * Value rules for the semantic string domains — one owner, so the seeders, the
 * validators and the verifiers cannot drift apart on what counts as valid.
 *
 * These replaced the old optional `format` property, which had zero producers
 * anywhere in the repo and no Rust counterpart at all: `format` was unreachable
 * from `.lolo`, so every consumer fell back to guessing from field names.
 */
/**
 * The one definition of the semantic string patterns, in the shared regex dialect (`validate/pattern`). The
 * `@almadar/std` `validate/email|url|phone|uuid` operators carry these exact strings in `canonical-operators.json`
 * (generated from here), so the kernel's validators and these readers cannot disagree. `image` is a URL.
 */
export const SEMANTIC_STRING_PATTERNS = {
    email: '^[^\\s@]+@[^\\s@.]+\\.[^\\s@]+$',
    url: '^https?://[^\\s]+$',
    phone: '^[+]?[\\d\\s().-]{7,}$',
    uuid: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
} as const;

const EMAIL_RE = new RegExp(SEMANTIC_STRING_PATTERNS.email);
const URL_RE = new RegExp(SEMANTIC_STRING_PATTERNS.url);
const PHONE_RE = new RegExp(SEMANTIC_STRING_PATTERNS.phone);
const UUID_RE = new RegExp(SEMANTIC_STRING_PATTERNS.uuid);

export function isEmailValue(value: string): boolean {
    return EMAIL_RE.test(value);
}

export function isUrlValue(value: string): boolean {
    return URL_RE.test(value);
}

export function isPhoneValue(value: string): boolean {
    return PHONE_RE.test(value);
}

export function isUuidValue(value: string): boolean {
    return UUID_RE.test(value);
}

// ============================================================================
// File value — the canonical struct a `file`-typed field holds at rest.
// ONE owner for the shape; mirrors `file_value_fields()` in orbital-core
// (ir/render.rs) and the codegen zod emitter.
// ============================================================================

/** The value a `file`-typed entity field holds: an uploaded artifact.
 *  `url` is a `data:` URI in mock/playground mode (size-ceilinged by the
 *  mock adapter) or an object-storage URL in production. */
export type FileValue = {
    name: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
};

/** Zod schema for {@link FileValue}. */
export const FileValueSchema = z.object({
    name: z.string(),
    url: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
});

/** Is `value` a well-formed {@link FileValue}? The `file` twin of
 *  `isSemanticStringValue` — the seeder's output must satisfy this. */
export function isFileValue(value: unknown): value is FileValue {
    return FileValueSchema.safeParse(value).success;
}

/** Does `value` satisfy the declared semantic domain? `image` is a URL. */
export function isSemanticStringValue(type: SemanticStringType, value: string): boolean {
    switch (type) {
        case 'email':
            return isEmailValue(value);
        case 'url':
        case 'image':
            return isUrlValue(value);
        case 'phone':
            return isPhoneValue(value);
        case 'uuid':
            return isUuidValue(value);
    }
}

// ============================================================================
// Entity Field — discriminated union by `type`
// ============================================================================

/**
 * Field-type tags that don't carry a type-dependent payload. The base
 * `EntityField` shape applies as-is.
 */
type ScalarFieldType =
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'timestamp'
    | 'datetime'
    | 'email'
    | 'url'
    | 'phone'
    | 'uuid'
    | 'image'
    | 'money'
    | 'file'
    | 'bytes'
    | 'trait'
    | 'orbital'
    | 'behavior'
    | 'slot'
    | 'pattern'
    | 'node'
    | 'event'
    | 'EventAddress'
    | 'CallKey'
    | 'SExpr';

/** Fields shared across every variant. */
type EntityFieldBase = {
    /**
     * Field name (camelCase). Optional for nested item/property descriptors
     * where the name is implied by the parent (`items`, `properties[k]`).
     * Mirrors Rust's `FieldDefinition.name: Option<String>`.
     */
    name?: string;
    /** Whether the field is required */
    required?: boolean;
    /** Primary-key marker. Mirrors Rust's `FieldDefinition.primary_key`
     *  (serde `primaryKey`). */
    primaryKey?: boolean;
    /** Default value — parsed from `.orb`, always JSON-shaped. */
    default?: JsonValue;
    /** Minimum value (for number) or length (for string) */
    min?: number;
    /** Maximum value or length */
    max?: number;
    /** Object property schemas keyed by property name (for object type).
     *  Mirrors Rust's `FieldDefinition.properties: Option<HashMap<String,
     *  FieldDefinition>>`. Populated by the lolo lowerer when a field /
     *  config slot's type expression resolves to a struct shape
     *  (`TypeExpr::Object`), including named-type aliases like `[MetricSpec]`. */
    properties?: Record<string, EntityField>;
    /** Runtime-managed widget state (authored `@intrinsic` in `.lolo`). Exempt
     *  from the explicit-binding rule and never a domain-data bind target. */
    intrinsic?: boolean;
    /** Human/semantic description (authored `@description "..."` in `.lolo`).
     *  Authoring/build-time metadata — factory-signature catalog, embeddings,
     *  curation field-matching; the runtime ignores it. */
    description?: string;
    /** User-vocabulary synonyms (authored `@synonyms "..."` in `.lolo`).
     *  Free text feeding catalog search / curation field-matching. */
    synonyms?: string;
    /** Declared mock value(s) (authored `@mock "..."` in `.lolo`), used
     *  LITERALLY by the seeder (`sampleValue.ts`, `seed.rs`) — never mapped
     *  through a domain-name lookup table. Comma-separated is an explicit
     *  candidate list rotated by row index (`@mock "Acme Corp, Globex Inc"`);
     *  no comma is a single literal value, index-suffixed per row
     *  (`@mock "person-name"` -> "person-name-1", "person-name-2", ...). */
    mock?: string;
    /**
     * The imported entity this field was merged from on a rebind (sibling
     * pull / entity contract). Absent on author-declared fields — a merged
     * field's `required` is the ATOM's own write contract, never the host
     * writer's.
     */
    mergedFrom?: string;
    /** `.lolo` `T.f`: the declared field this field's type was projected from. */
    projectedFrom?: FieldProjection;
};

/**
 * Scalar / structural fields — no type-dependent payload required.
 * `values?` is permitted as an OPTIONAL UI/validation hint (e.g. lolo's
 * `'a' | 'b' | 'c'` string-union sugar lowers to `type: 'string', values:
 * [...]`). Only `EnumEntityField` MANDATES values.
 */
export type ScalarEntityField = EntityFieldBase & {
    type: ScalarFieldType;
    /** Optional vocabulary hint for scalar fields (e.g. string unions
     *  authored as `'a'|'b'|'c'` in lolo). Not required at this variant. */
    values?: string[];
};

/** `type: 'enum'` REQUIRES the closed vocabulary in `values`. */
export type EnumEntityField = EntityFieldBase & {
    type: 'enum';
    /** Closed string vocabulary the field accepts. */
    values: string[];
};

/** `type: 'relation'` REQUIRES the relation target binding. */
export type RelationEntityField = EntityFieldBase & {
    type: 'relation';
    /** Relation target binding (entity + cardinality). */
    relation: RelationConfig;
};

/**
 * `type: 'union'` — a TAGGED union of struct variants (`.lolo`
 * `type DrawItem = DrawShape | DrawText`). `values` carries the variant NAMES
 * in declaration order; `properties` (from the base shape) carries each
 * variant's shape keyed by that name. A value selects its variant by the
 * variant's literal-typed tag field, else by the one closed shape it fits
 * (orbital-core `select_union_variant`). Recursion is carried
 * BY NAME: a variant referring back to the union gets `values` with no
 * `properties` (mirrors `FieldType::Union` in orbital-core).
 */
export type UnionEntityField = EntityFieldBase & {
    type: 'union';
    /** Variant type names in declaration order. */
    values: string[];
};

/** `type: 'array'` — element schema in `items` strongly preferred but
 *  optional for legacy compatibility with codegen-emitted scalar-array
 *  fields (e.g. `{type: 'array', default: []}`). The lolo lowerer + Rust
 *  validator catch typed-element-required cases downstream. */
export type ArrayEntityField = EntityFieldBase & {
    type: 'array';
    /** Element schema for the array. */
    items?: EntityField;
};

/** `type: 'tuple'` — a fixed-length tuple (`.lolo` `[T1, T2, …]`, Rust
 *  `FieldType::Tuple`): each slot's schema rides `properties`, keyed `"0"`, `"1"`, …. */
export type TupleEntityField = EntityFieldBase & {
    type: 'tuple';
    properties: Record<string, EntityField>;
};

/**
 * `type: 'object'` — a fixed-key struct (fields in `properties`) OR a
 * dynamic-key map (`Map K V` in `.lolo`; the uniform value schema lives in
 * `items`, mirroring an array's element schema). A distinct variant so `items`
 * is statically allowed only on object/array fields, never on scalars.
 */
export type ObjectEntityField = EntityFieldBase & {
    type: 'object';
    /** Uniform value schema for a dynamic-key map (`Map K V`). */
    items?: EntityField;
};

/**
 * Entity field definition — discriminated union by `type`. Each variant
 * statically enforces its dependent payload (`values` for enum,
 * `relation` for relation, `items` for array) so TS / Zod / JSON Schema
 * consumers all agree on the dependency, not just the Rust validator.
 *
 * @example
 * { name: 'status', type: 'enum', values: ['draft', 'published'] }
 * { name: 'authorId', type: 'relation', relation: { entity: 'User', cardinality: 'one' } }
 * { name: 'tags', type: 'array', items: { type: 'string' } }
 */
/** A field typed by an unbound type variable; binding substitutes it. */
export type TypeVariableEntityField = EntityFieldBase & {
    type: TypeVariable;
};

export function isTypeVariableField(f: EntityField): f is TypeVariableEntityField {
    return isTypeVariable(f.type);
}

export type EntityField =
    | TypeVariableEntityField
    | ScalarEntityField
    | EnumEntityField
    | RelationEntityField
    | UnionEntityField
    | ArrayEntityField
    | TupleEntityField
    | ObjectEntityField;

/**
 * Alias map for legacy/loose field-type spellings. Preprocessed into the
 * canonical `FieldType` enum before zod validates. Without this, agent-produced
 * schemas using `text`/`int`/`float`/`ts` were rejected at parse time — this
 * normalizes them so the rest of the pipeline sees only canonical types.
 */
const FIELD_TYPE_ALIASES: Record<string, FieldType> = {
    text: 'string',
    int: 'number',
    float: 'number',
    ts: 'timestamp',
};

/**
 * Zod schema for `EntityField`. Preprocess normalizes:
 *   - legacy `type` aliases (text → string, int → number, etc.)
 *   - legacy `enum: string[]` alias → `values: string[]`
 *
 * Branches on `type` so TS narrows the parsed output to the matching
 * discriminated-union variant.
 */
// The third type param stays `unknown`: zod v3 bakes `unknown` into
// `z.preprocess`'s input type, and the recursion needs the explicit annotation.
export const EntityFieldSchema: z.ZodType<EntityField, z.ZodTypeDef, unknown> = z.lazy(() => {
    const baseFieldShape = {
        name: z.string().min(1, 'Field name is required').optional(),
        required: z.boolean().optional(),
        primaryKey: z.boolean().optional(),
        default: JsonValueSchema.optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        properties: z.record(EntityFieldSchema).optional(),
        intrinsic: z.boolean().optional(),
        description: z.string().optional(),
        synonyms: z.string().optional(),
        mock: z.string().optional(),
        mergedFrom: z.string().optional(),
        projectedFrom: FieldProjectionSchema.optional(),
    };

    /** Build a scalar variant schema. `values?` is permitted as a hint;
     *  only the enum variant mandates a non-empty values array. */
    function scalarVariant<T extends ScalarFieldType>(t: T) {
        return z.object({
            ...baseFieldShape,
            type: z.literal(t),
            values: z.array(z.string()).optional(),
        });
    }

    return z.preprocess(
        (input) => {
            if (
                input === null ||
                typeof input !== 'object' ||
                !('type' in input) ||
                typeof (input as { type?: RuntimeValue }).type !== 'string'
            ) {
                return input;
            }
            const obj = input as { type: string; enum?: RuntimeValue; values?: RuntimeValue };
            const next: { type: string; enum?: RuntimeValue; values?: RuntimeValue } = { ...obj };
            const aliased = FIELD_TYPE_ALIASES[obj.type];
            if (aliased !== undefined) next.type = aliased;
            // Fold legacy `enum: string[]` into `values: string[]`.
            if (next.enum !== undefined && next.values === undefined) {
                next.values = next.enum;
            }
            delete next.enum;
            return next;
        },
        z.union([
            z.object({ ...baseFieldShape, type: TypeVariableSchema }),
            z.discriminatedUnion('type', [
                scalarVariant('string'),
                scalarVariant('number'),
                scalarVariant('boolean'),
                scalarVariant('date'),
                scalarVariant('timestamp'),
                scalarVariant('datetime'),
                scalarVariant('email'),
                scalarVariant('url'),
                scalarVariant('phone'),
                scalarVariant('uuid'),
                scalarVariant('image'),
                scalarVariant('trait'),
                scalarVariant('orbital'),
                scalarVariant('behavior'),
                scalarVariant('slot'),
                scalarVariant('pattern'),
                scalarVariant('node'),
                scalarVariant('event'),
                scalarVariant('EventAddress'),
                scalarVariant('CallKey'),
                scalarVariant('money'),
                scalarVariant('file'),
                scalarVariant('bytes'),
                scalarVariant('SExpr'),
                // Enum variant — REQUIRES non-empty values.
                z.object({
                    ...baseFieldShape,
                    type: z.literal('enum'),
                    values: z.array(z.string()).min(1, 'Enum field requires a non-empty `values` array'),
                }),
                // Union variant — tagged struct union; values = variant names,
                // per-variant shapes in `properties` (absent on named recursion).
                z.object({
                    ...baseFieldShape,
                    type: z.literal('union'),
                    values: z.array(z.string()).min(1, 'Union field requires a non-empty `values` array'),
                }),
                // Relation variant — REQUIRES relation config.
                z.object({
                    ...baseFieldShape,
                    type: z.literal('relation'),
                    relation: RelationConfigSchema,
                }),
                // Array variant — items optional to match relaxed TS shape.
                z.object({
                    ...baseFieldShape,
                    type: z.literal('array'),
                    items: EntityFieldSchema.optional(),
                }),
                // Tuple variant — slots in `properties`, keyed by index (at least one).
                z.object({
                    ...baseFieldShape,
                    type: z.literal('tuple'),
                    properties: z.record(EntityFieldSchema).refine((p) => Object.keys(p).length > 0, 'Tuple field requires slots in `properties`'),
                }),
                // Object variant — fixed-key struct (`properties`) or dynamic-key
                // map (`Map K V`, uniform value schema in `items`).
                z.object({
                    ...baseFieldShape,
                    type: z.literal('object'),
                    items: EntityFieldSchema.optional(),
                    values: z.array(z.string()).optional(),
                }),
            ]),
        ]),
    );
});

export type EntityFieldInput = z.input<typeof EntityFieldSchema>;

// ============================================================================
// Type Aliases (for cleaner imports)
// ============================================================================

/** Alias for EntityField - preferred name */
export type Field = EntityField;

/** Alias for EntityFieldSchema - preferred name */
export const FieldSchema = EntityFieldSchema;
