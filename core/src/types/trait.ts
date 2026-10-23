/**
 * Trait Types (Self-Contained)
 *
 * Defines trait types for behavioral patterns.
 * Self-contained - imports only from local orbital types.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { FieldProjectionSchema, type FieldProjection } from './projection.js';
import type { TraitId, EntityId, EventId, PageId, OrbitalId } from './identity.js';
import { TraitIdSchema, EntityIdSchema, EventIdSchema, PageIdSchema, OrbitalIdSchema } from './identity.js';
import type { StateMachine, PayloadTypeWhen } from './state-machine.js';
import { StateMachineSchema, PayloadTypeWhenSchema } from './state-machine.js';
import type { Effect } from './effect.js';
import { EffectSchema, PatternObjectSchema } from './effect.js';
import type { Entity } from './entity.js';
import { EntitySchema } from './entity.js';
import type { AnyPatternConfig } from '../patterns/index.js';
import type { Expression, SExpr } from './expression.js';
import { ExpressionSchema, SExprSchema } from './expression.js';
import { JsonValueSchema } from './json.js';
import { EntityFieldSchema, TypeVariableSchema, type EntityField, type TypeVariable } from './field.js';

// ============================================================================
// Trait Configuration
// ============================================================================

/**
 * A single value in a trait's call-site `config: { ... }` block. Supports
 * scalars (string, number, boolean, null), arrays (e.g. `fields: ["name",
 * "description"]`), and nested objects. This is the authoring surface for
 * molecules to parameterize imported atoms: the atom's render-ui reads back
 * via `@config.<key>` bindings.
 */
export type TraitConfigValue =
    | string
    | number
    | boolean
    | null
    | ReadonlyArray<TraitConfigValue>
    | TraitConfigObject;

export type TraitConfigObject = {
    readonly [key: string]: TraitConfigValue;
};

export type TraitConfig = TraitConfigObject;

/** Zod schema for TraitConfig. Recursive via z.lazy to allow nested structures. */
export const TraitConfigValueSchema: z.ZodType<TraitConfigValue> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(TraitConfigValueSchema),
        z.record(TraitConfigValueSchema),
    ])
);

export const TraitConfigSchema: z.ZodType<TraitConfig> = z.record(TraitConfigValueSchema);

/**
 * A single entry in a call-site `config { }` override block. Either a plain
 * wiring value (`TraitConfigValue` — string, number, bool, array, object) or
 * a fully-annotated re-declaration (`ConfigFieldDeclaration` — carries `type`,
 * optional `label`/`description`/`synonyms`/`tier`). Disambiguated at runtime
 * by `isCallSiteConfigDeclaration`: the presence of a `"type"` string key
 * marks the annotated form.
 *
 * The `.orb` compiler emits plain values for wiring entries and
 * `{ type, default, ... }` objects for annotated entries. Consumers that only
 * need the value (e.g. `apply-params-to-orb.ts`) read `entry` directly for
 * primitives or `entry.default` for the declaration form.
 */
export type CallSiteConfigEntry = TraitConfigValue | ConfigFieldDeclaration;

/** Typed map of call-site config entries (one per knob). */
export type CallSiteConfig = Readonly<Record<string, CallSiteConfigEntry>>;

/**
 * Type guard: returns `true` when `entry` is an annotated `ConfigFieldDeclaration`
 * (a config-field SCHEMA: a `"type"` string key AND a `"default"` value slot)
 * rather than a plain wiring value or a render value object.
 *
 * The `"default"` requirement disambiguates a declaration from a `render-ui`
 * VALUE object (e.g. `{ type: "tabs", items: "@entity.items", ... }`) that
 * coincidentally carries a UI-component `type` key — such a value has no
 * `default` slot and is a `TraitConfigValue`, not a schema declaration. Every
 * annotated config field lowered from `.lolo` carries a `default`; misreading a
 * render value as a declaration drops it straight into the `config` map where
 * Rust's `serde` rejects its inner fields (e.g. `items` is a binding string,
 * not a `FieldDefinition`).
 */
export function isCallSiteConfigDeclaration(
    entry: CallSiteConfigEntry,
): entry is ConfigFieldDeclaration {
    return (
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        'type' in entry &&
        typeof entry.type === 'string' &&
        'default' in entry
    );
}

/**
 * Whether a call-site config entry RE-DECLARES its knob (legal for a knob the trait does not
 * declare) rather than setting a value. Twin of orbital-core `ConfigField::is_declaration_form`:
 * a value wrapped as `{ type: 'unknown', default }` (what `mergeCallSiteConfigOverrides` builds)
 * is a value; a typed declaration, or one carrying `label`/`description`/`synonyms`/`tier`, is not.
 */
export function isConfigRedeclaration(entry: CallSiteConfigEntry): boolean {
    if (!isCallSiteConfigDeclaration(entry)) return false;
    return (
        entry.type !== 'unknown' ||
        entry.label !== undefined ||
        entry.description !== undefined ||
        entry.synonyms !== undefined ||
        entry.tier !== undefined
    );
}

/** Metadata keys that only ever appear on a declared config-field SCHEMA
 *  (never on a render-value object that merely carries a UI `type` key). */
const CONFIG_DECLARATION_META_KEYS = ['label', 'description', 'tier', 'synonyms', 'values'] as const;

/**
 * Type guard: `entry` is a declared config-field SCHEMA — a string `type` plus
 * EITHER a `default` slot OR declaration metadata (`label`/`description`/
 * `tier`/`synonyms`/`values`). Broader than `isCallSiteConfigDeclaration`,
 * which requires a `default`: a field declared with no default (e.g.
 * `leftIcon : icon` → `{ type: "icon", label, description, tier }`) is still a
 * schema, and its runtime VALUE is its (absent → `undefined`) default, NOT the
 * schema object itself. A render-value object that coincidentally has a `type`
 * key (e.g. `{ type: "tabs", items: … }`) carries none of these metadata keys
 * and is therefore left untouched as a plain value.
 */
export function isConfigFieldSchema(entry: CallSiteConfigEntry): entry is ConfigFieldDeclaration {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    if (!('type' in entry) || typeof (entry as { type?: TraitConfigValue }).type !== 'string') return false;
    return 'default' in entry || CONFIG_DECLARATION_META_KEYS.some((k) => k in entry);
}

/**
 * Convert a call-site config map into plain runtime values.
 *
 * A `CallSiteConfig` may contain either plain wiring values
 * (`TraitConfigValue`) or annotated `ConfigFieldDeclaration` objects
 * (`{ type, default, label, ... }`). Both the JS interpreter
 * (`@almadar/runtime`) and the render substrate (`@almadar/ui`) need this
 * extraction, so it lives here — the most-upstream package they share —
 * rather than being duplicated in each.
 *
 * A declared field with no `default` yields no value (dropped), as the
 * kernel reads it. Leaking such a schema object through as a
 * value made `@config.leftIcon` resolve to `{ type: "icon", … }`, which the
 * render substrate then mounted as an element and passed to `Input`'s icon
 * slot → "Element type is invalid: got <SlotContentRenderer />".
 */
export function normalizeCallSiteConfigToValues(
    config: CallSiteConfig | undefined,
): TraitConfig | undefined {
    if (config === undefined) {
        return undefined;
    }

    const out: Record<string, TraitConfigValue> = {};
    let hasAny = false;
    for (const [key, entry] of Object.entries(config)) {
        const value = isConfigFieldSchema(entry)
            ? entry.default
            : entry;
        if (value !== undefined) {
            out[key] = value;
            hasAny = true;
        }
    }

    return hasAny ? out : undefined;
}

/**
 * Merge call-site config overrides onto a base `CallSiteConfig`. Every entry
 * in the result is a `ConfigField` (Rust's `HashMap<String, ConfigField>`):
 * bare values — base AND override — are wrapped as `{ type: 'unknown', default }`
 * when not already a declaration. Override folds into an existing declaration's
 * `default` field.
 */
export function mergeCallSiteConfigOverrides(
  base: CallSiteConfig,
  overrides: CallSiteConfig,
): Record<string, ConfigFieldDeclaration> {
  const next: Record<string, ConfigFieldDeclaration> = {};
  for (const [k, entry] of Object.entries(base)) {
    next[k] = isConfigFieldSchema(entry)
      ? entry
      : { type: 'unknown', default: entry };
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (isCallSiteConfigDeclaration(v)) {
      next[k] = v;
      continue;
    }
    const existing = base[k];
    next[k] = existing !== undefined && isConfigFieldSchema(existing)
      ? { ...existing, default: v }
      : { type: 'unknown', default: v };
  }
  return next;
}

/**
 * Per-field entry in a trait's DECLARED `config { }` schema as it lives
 * on the `.orb` JSON: `{ type: "string" | "[string]" | "object" | ...,
 * default?: <value> }`. Distinct from `TraitConfigValue` (which is the
 * resolved runtime value). The runtime reads `default` to seed the
 * `@config.X` binding context when no call-site override is supplied.
 *
 * Authored as `config { foo : string = "bar" }` in `.lolo`; lowered to
 * `{ foo: { type: "string", default: "bar" } }` in `.orb`. The optional
 * metadata fields below (`label`/`description`/`tier`/`values`/`synonyms`)
 * carry the `.lolo` `@label`/`@description`/`@tier`/`@synonyms` annotations and
 * the enum member list through lowering — consumed by config-driven UI
 * (e.g. the playground property inspector) to render typed controls.
 */
/**
 * The reference config-field types (V4-W5). A config knob typed `entity`,
 * `trait`, or `event` holds a REFERENCE (an entity/trait/event name), not a
 * plain value — so the stamp records the referenced node's id on the field
 * (`ConfigFieldDeclaration.refId`) and both execution paths resolve the value to
 * the node's CURRENT name by id, exactly like `entityRefIds`/`traitEmbedIds`.
 * This is the deterministic, source-tagged contract that lets a declaration-only
 * rename flow through a config value without any name-scanning heuristic.
 */
export const REFERENCE_CONFIG_TYPES = ['entity', 'trait', 'event'] as const;
export type ReferenceConfigType = (typeof REFERENCE_CONFIG_TYPES)[number];

/** True when a config field's `type` marks its value as an entity/trait/event reference. */
export function isReferenceConfigType(type: string): type is ReferenceConfigType {
    return (REFERENCE_CONFIG_TYPES as readonly string[]).includes(type);
}

/**
 * The secret config-field types. A config knob typed `secret` holds a
 * credential REFERENCE (an env-var key name for `resolveCredentialRef`) —
 * and, as defense-in-depth against a host wrongly inlining material, its
 * VALUE must never flow into spec.json, traces, plan snapshots, or factory
 * bakes in cleartext: consumers mask it (see `maskSecretConfigValues`) and
 * UI password-renders the knob. `.lolo` accepts `: secret` as a config-field
 * type (I-29, 2026-08-23 — previously the parser silently read it as a
 * meaningless named type); this contract is the single deterministic source
 * downstream consumers (studio, verifiers, rabit bakes) key on.
 */
export const SECRET_CONFIG_TYPES = ['secret'] as const;
export type SecretConfigType = (typeof SECRET_CONFIG_TYPES)[number];

/** True when a config field's `type` marks its value as a credential to be masked. */
export function isSecretConfigType(type: string): type is SecretConfigType {
    return (SECRET_CONFIG_TYPES as readonly string[]).includes(type);
}

/**
 * Return `values` with every `secret`-declared field's string value masked to
 * its last 4 characters (shorter values fully masked). Non-secret fields and
 * non-string values pass through untouched. Use before echoing call-site
 * config into traces, spec snapshots, or logs.
 */
export function maskSecretConfigValues(
    config: DeclaredTraitConfig,
    values: TraitConfig,
): TraitConfig {
    const masked: Record<string, TraitConfigValue> = {};
    for (const [key, value] of Object.entries(values)) {
        const decl = config[key];
        if (decl !== undefined && isSecretConfigType(decl.type) && typeof value === 'string' && value.length > 0) {
            masked[key] = value.length > 4 ? `••••${value.slice(-4)}` : '••••';
        } else {
            masked[key] = value;
        }
    }
    return masked;
}

/**
 * A `trait`-typed knob's override may spell the unbound sentinel as the bare
 * `none` — `orbital-lolo`'s plain-wiring grammar has no static type at the
 * call site, so it lowers `none` to the literal string `"none"` like any
 * other identifier. This is the one place the field's declared `type` is
 * known, so it is where the string is canonicalized to `null` — the
 * language's single "unbound" representation for a `trait`-typed knob
 * (owner ruling 2026-09-13), mirroring the compiler's
 * `canonicalize_unbound_trait_override` (`orbital-compiler/src/phases/
 * inline/trait.rs`). A no-op for every other type or value.
 */
function canonicalizeUnboundTraitOverride(fieldType: string, value: TraitConfigValue): TraitConfigValue {
    return fieldType === 'trait' && value === 'none' ? null : value;
}

/**
 * Fold an override value map onto a `DeclaredTraitConfig`'s per-knob
 * `default`, mirroring the compiler's `ORB_O_CONFIG_UNKNOWN_KEY` check.
 * Single owner for the factory-runtime overlay (`applyParamsToOrb` folding
 * `OrbitalFactoryParams.config`) and the runtime's `OrbitalRefObject.config`
 * fold (`reference-resolver.ts`) — same operation, two call sites.
 *
 * Throws when `overrides` names a key `declared` does not declare. Callers
 * validate the override keys against the manifest / upstream config first
 * (`validateOrbitalFactoryParams`, the resolver's own pre-check), so this is
 * a should-never-happen guard, not a user-facing error path.
 */
export function overrideDeclaredKnobs(
    declared: DeclaredTraitConfig,
    overrides: Readonly<Record<string, TraitConfigValue>>,
): DeclaredTraitConfig {
    const out: Record<string, ConfigFieldDeclaration> = { ...declared };
    for (const key of Object.keys(overrides)) {
        const field = declared[key];
        if (field === undefined) {
            throw new Error(
                `overrideDeclaredKnobs: config override "${key}" is not a declared knob ` +
                    `(ORB_O_CONFIG_UNKNOWN_KEY). Declared: ${Object.keys(declared).join(', ') || '(none)'}`,
            );
        }
        out[key] = { ...field, default: canonicalizeUnboundTraitOverride(field.type, overrides[key]) };
    }
    return out;
}

export type ConfigFieldDeclaration = {
    readonly nullable?: boolean;
    readonly additionalProperties?: EntityField;
    readonly type: string;
    readonly default?: TraitConfigValue;
    /**
     * V4-W5 dual-carry id — set by the stamp when `type` is a reference config
     * type (`entity`/`trait`/`event`): the stable id of the entity/trait/event
     * the field's value names. Readers resolve the value to that node's current
     * name by id (rename-proof); absent for non-reference fields.
     */
    readonly refId?: string;
    /** Marks the knob as mandatory at every call site (own-page binding exempt). `required` + `default` may coexist — the default only serves the trait's own demo page. */
    readonly required?: boolean;
    /** `@label` — human-readable control label. */
    readonly label?: string;
    /** `@description` — help/tooltip text for the field. */
    readonly description?: string;
    /** `@tier` — disclosure tier: `presentation`|`domain`|`policy`|`infra`|`internal`. */
    readonly tier?: string;
    /** Enum members when the field's type is a string union — drives a select control. */
    readonly values?: ReadonlyArray<string>;
    /** `@synonyms` — comma-separated vocabulary synonyms (metadata). */
    readonly synonyms?: string;
    /** Structured per-item schema for array-of-object fields — `edges : [{from: string!, …}]` in `.lolo` lowers to `{ type: "object", properties: {…} }`. */
    readonly items?: ConfigFieldItemsDeclaration;
    /** Structured property schema for object-typed config fields (no items wrapper). */
    readonly properties?: Readonly<Record<string, TraitEntityField>>;
    /**
     * Provenance for a collapsed knob forward. The L2 inline phase (and the
     * runtime resolver) fold a trait's `default: "@config.<knob>"` (or a
     * call-site override of the same shape) down to the resolved value, so
     * the resolved schema no longer carries the literal `@config.<knob>`
     * token anywhere. `forwardedFrom` records that token — the original
     * app/orbital-level knob name this field's value came from — so a
     * dead-knob check (`ORB_O_CONFIG_DEAD_KNOB` / `orbital-config-knob-unforwarded`)
     * can still recognize the knob as forwarded on an already-resolved
     * schema. Absent when the field's `default`/value was authored directly
     * (not a forward), or on an unresolved schema where the `@config.<knob>`
     * token itself is still present.
     */
    readonly forwardedFrom?: string;
    /**
     * The `@config.<knob>` tokens nested INSIDE this field's value (an array
     * element or object member, e.g. `metrics[].target`) that the resolver
     * folded to their values — the list twin of `forwardedFrom`, so the
     * dead-knob check still sees those knobs as read. Absent when nothing
     * nested resolved. Compiled-path wire key `nestedForwardedFrom`.
     */
    readonly nestedForwardedFrom?: ReadonlyArray<string>;
    /**
     * The definer knob this field is the payload companion of, when its
     * declared type was `@payload(<knob>)`: the L2 sigil pass rewrites the
     * sentinel to the resolved payload type and records the knob here, the
     * same way `forwardedFrom` keeps a provenance the resolved `default` /
     * `type` can no longer show. Absent for any field that was never a
     * `@payload(<knob>)` sentinel. Compiled-path wire key `payloadFor`.
     */
    readonly payloadFor?: string;
    /** `.lolo` `T.f`: the declared field this knob's type was projected from. */
    readonly projectedFrom?: FieldProjection;
};

export type ConfigFieldItemsDeclaration = {
    readonly nullable?: boolean;
    readonly additionalProperties?: EntityField;
    readonly type?: string;
    /** Absent for arrays of scalars (`items: { type: "string" }`). */
    readonly properties?: Readonly<Record<string, TraitEntityField>>;
    /** Nested per-item schema for arrays of arrays (recursive). */
    readonly items?: ConfigFieldItemsDeclaration;
    /** Union member names when the item type is a union — including a by-name recursive back-reference. */
    readonly values?: ReadonlyArray<string>;
};

export const ConfigFieldItemsDeclarationSchema: z.ZodType<ConfigFieldItemsDeclaration, z.ZodTypeDef, object> = z.lazy(() =>
    z.object({
    nullable: z.boolean().optional(),
    additionalProperties: EntityFieldSchema.optional(),
        type: z.string().optional(),
        properties: z.record(TraitEntityFieldSchema).optional(),
        items: ConfigFieldItemsDeclarationSchema.optional(),
        values: z.array(z.string()).optional(),
    }),
);

export const ConfigFieldDeclarationSchema: z.ZodType<ConfigFieldDeclaration, z.ZodTypeDef, object> = z.object({
    nullable: z.boolean().optional(),
    additionalProperties: EntityFieldSchema.optional(),
    type: z.string(),
    default: TraitConfigValueSchema.optional(),
    refId: z.string().optional(),
    required: z.boolean().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    tier: z.string().optional(),
    values: z.array(z.string()).optional(),
    synonyms: z.string().optional(),
    items: ConfigFieldItemsDeclarationSchema.optional(),
    properties: z.lazy(() => z.record(TraitEntityFieldSchema)).optional(),
    forwardedFrom: z.string().optional(),
    nestedForwardedFrom: z.array(z.string()).optional(),
    payloadFor: z.string().optional(),
    projectedFrom: FieldProjectionSchema.optional(),
});

/**
 * Map of declared config fields keyed by name. Lives on `Trait.config`
 * and `ResolvedTrait.config` for atoms/molecules that expose typed
 * configuration to consumers.
 */
export type DeclaredTraitConfig = Readonly<Record<string, ConfigFieldDeclaration>>;

export const DeclaredTraitConfigSchema: z.ZodType<DeclaredTraitConfig, z.ZodTypeDef, Record<string, object>> = z.record(
    ConfigFieldDeclarationSchema,
);

// ============================================================================
// Trait Categories
// ============================================================================

/**
 * Categories for organizing traits
 */
export type TraitCategory =
    | 'lifecycle'
    | 'temporal'
    | 'validation'
    | 'notification'
    | 'integration'
    | 'interaction'
    | 'agent'
    | 'game-core'
    | 'game-character'
    | 'game-ai'
    | 'game-combat'
    | 'game-items'
    | 'game-cards'
    | 'game-board'
    | 'game-puzzle';

export const TraitCategorySchema = z.enum([
    'lifecycle',
    'temporal',
    'validation',
    'notification',
    'integration',
    'interaction',
    'agent',
    'game-core',
    'game-character',
    'game-ai',
    'game-combat',
    'game-items',
    'game-cards',
    'game-board',
    'game-puzzle',
]);

// ============================================================================
// Trait Entity Field (simplified)
// ============================================================================

/**
 * Field types for trait data entities
 */
// `trait` / `slot` / `pattern` mirror Rust's `FieldType::{Trait, Slot, Pattern}`
// (orbital-core schema/types.rs) — config-field-only types: a `@trait.X`
// embed slot, a UI slot name, a pattern type name.
// `union` is the closed variant type — a real .lolo/.orb type, so the
// trait-side mirror must carry it or generated factories fail DTS.
export type TraitFieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'timestamp' | 'datetime' | 'enum' | 'email' | 'url' | 'phone' | 'uuid' | 'image' | 'bytes' | 'trait' | 'slot' | 'pattern' | 'node' | 'event' | 'EventAddress' | 'CallKey' | 'SExpr' | 'union' | 'tuple' | TypeVariable;

/** Every `TraitFieldType`, as a runtime array — the ONE list `TraitEntityFieldSchema`
 *  and `RequiredFieldSchema` both read. Two separate inline copies of this enum had
 *  already fallen behind the TS type twice (`node` missing, then `union`
 *  missing) — mirrors the `FIELD_TYPES` fix for `FieldType` in `field.ts`. */
export const TRAIT_FIELD_TYPES = [
    'string',
    'number',
    'boolean',
    'date',
    'array',
    'object',
    'timestamp',
    'datetime',
    'enum',
    'email',
    'url',
    'phone',
    'uuid',
    'image',
    'bytes',
    'trait',
    'slot',
    'pattern',
    'node',
    'event',
    'EventAddress',
    'CallKey',
    'SExpr',
    'union',
    'tuple',
] as const satisfies readonly TraitFieldType[];

/**
 * Simplified field for trait data entities
 */
export type TraitEntityField = {
    nullable?: boolean;
    additionalProperties?: EntityField;
    name: string;
    type: TraitFieldType;
    required?: boolean;
    /** Field default parsed from `.orb` — always a JSON-shaped value. */
    default?: TraitConfigValue;
    values?: string[];
    /** Structured per-item schema for array-of-object fields (recursive). */
    items?: ConfigFieldItemsDeclaration;
    /** Structured property schema for object-typed entity fields. */
    properties?: Readonly<Record<string, TraitEntityField>>;
};

export const TraitEntityFieldSchema: z.ZodType<TraitEntityField, z.ZodTypeDef, object> = z.object({
    nullable: z.boolean().optional(),
    additionalProperties: EntityFieldSchema.optional(),
    name: z.string().min(1),
    type: z.union([z.enum(TRAIT_FIELD_TYPES), TypeVariableSchema]),
    required: z.boolean().optional(),
    default: TraitConfigValueSchema.optional(),
    values: z.array(z.string()).optional(),
    items: ConfigFieldItemsDeclarationSchema.optional(),
    properties: z.lazy(() => z.record(TraitEntityFieldSchema)).optional(),
});

// ============================================================================
// Trait Data Entity
// ============================================================================

/**
 * Simplified data entity for traits
 */
export type TraitDataEntity = {
    name: string;
    collection?: string;
    fields: TraitEntityField[];
    timestamps?: boolean;
    description?: string;
    runtime?: boolean;
    singleton?: boolean;
    pages?: string[];
};

export const TraitDataEntitySchema = z.object({
    name: z.string().min(1),
    collection: z.string().optional(),
    fields: z.array(TraitEntityFieldSchema).min(1),
    timestamps: z.boolean().optional(),
    description: z.string().optional(),
    runtime: z.boolean().optional(),
    singleton: z.boolean().optional(),
    pages: z.array(z.string()).optional(),
});

// ============================================================================
// Trait Tick
// ============================================================================

/**
 * Tick rule for traits.
 * Guards can be legacy strings or S-expressions.
 * Effects can be typed Effect objects or S-expressions.
 */
export type TraitTick = {
    name: string;
    description?: string;
    priority?: number;
    interval: string | number;
    appliesTo?: string[];
    /** `[background]`: runs with no client mounted; otherwise paused while no client has the trait mounted. */
    runsInBackground?: boolean;
    /** `[visible]`: a browser tick that pauses while its trait's rendered output is off screen. */
    whileVisible?: boolean;
    pages?: string[];
    /** V4 dual-carry id sibling of `pages` — optional until the Phase-7 flip. */
    pageIds?: PageId[];
    /** Guard expression - string (legacy) or S-expression array */
    guard?: Expression;
    /** Effects to execute (S-expressions) */
    effects: Effect[];
    /**
     * Events this tick emits.
     * Must reference events defined in trait's emits array.
     * Used for validation and documentation.
     */
    emits?: string[];
    /** V4 dual-carry id sibling of `emits` — optional until the Phase-7 flip. */
    emitIds?: EventId[];
};

/** `"500ms"` / `"5s"` / `"1m"` / `"1h"` / `"1d"` — the duration form both schedulers parse. */
const DURATION_INTERVAL = /^\d+(ms|s|m|h|d)$/;
/** A 5-field cron expression, e.g. `"0 9 * * *"`. */
const CRON_INTERVAL = /^\S+(\s+\S+){4}$/;

/**
 * A tick's cadence: `"frame"`, a positive number of milliseconds, a duration
 * string, or a cron expression.
 *
 * This schema previously accepted only `"frame"` or a number, while `TraitTick`
 * declared `string | number` and BOTH schedulers already parsed durations and cron
 * (`OrbitalServerRuntime.registerTick` → `isValidCronExpression`/
 * `parseDurationString`; Rust `TickScheduler::parse_interval` → `cron::parse_cron`).
 * The gate therefore rejected every cron/duration tick before its runtime could
 * run it — `std-data-erasure`'s hourly `executionScan` made the whole orbital
 * unloadable in the interpreter with only `traits.N: Invalid input` to go on.
 */
export const TickIntervalSchema = z.union([
    z.literal('frame'),
    z.number().positive(),
    z.string().refine((v) => DURATION_INTERVAL.test(v) || CRON_INTERVAL.test(v), {
        message:
            'interval must be "frame", a positive number of milliseconds, a duration ("500ms"/"5s"/"1m"/"1h"/"1d"), or a 5-field cron expression ("0 9 * * *")',
    }),
]);

export const TraitTickSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().optional(),
    interval: TickIntervalSchema,
    appliesTo: z.array(z.string()).optional(),
    runsInBackground: z.boolean().optional(),
    whileVisible: z.boolean().optional(),
    pages: z.array(z.string()).optional(),
    pageIds: z.array(PageIdSchema).optional(),
    guard: ExpressionSchema.optional(),
    effects: z.array(EffectSchema).min(1),
    emits: z.array(z.string()).optional(),
    emitIds: z.array(EventIdSchema).optional(),
});

// ============================================================================
// Event Scope
// ============================================================================

/**
 * Event scope determines visibility:
 * - 'internal': Trait-to-trait within same orbital (default)
 * - 'external': Exposed for cross-orbital communication
 */
export type EventScope = 'internal' | 'external';

export const EventScopeSchema = z.enum(['internal', 'external']);

// ============================================================================
// Event Payload Field
// ============================================================================

/**
 * Payload field definition for events.
 * Defines the structure of data carried by events.
 */
export type EventPayloadField = {
    /** Field name */
    name: string;
    /**
     * Field type. Any non-empty string, mirroring the Rust validator's
     * acceptance (Zod schema below uses `z.string().min(1)`). Well-known
     * values include the primitives (`string`, `number`, `boolean`,
     * `object`, `array`, `entity`), date variants (`date`, `datetime`,
     * `timestamp`), entity-name references (`User`), and array-of-entity
     * shorthand (`[User]`). Narrowing happens at the call sites that care
     * (e.g. `orbital-compiler/phases/validation/emit_payload.rs`), not at
     * the structural type level — this keeps `.orb`-emitted payloads
     * round-trippable through TypeScript without losing precision.
     */
    type: string;
    /** Whether field is required in payload */
    required?: boolean;
    nullable?: boolean;
    additionalProperties?: EventPayloadField;
    /** Closed value set (`"a" | "b"`) — element-wise for an array type. */
    values?: ReadonlyArray<string>;
    /** Human-readable description */
    description?: string;
    /** For 'entity' type: the entity type name */
    entity?: string;
    /** Structured property schema for object-typed payload fields (recursive). */
    properties?: ReadonlyArray<EventPayloadField>;
    /**
     * Declared knob-conditional type list (`match` in `.lolo`, §25 —
     * REPLACED the `@typeWhen` annotation spelling outright) — see
     * `PayloadTypeWhen` in `state-machine.ts`. Resolved and cleared once
     * composed; the emitted `.orb` carries only the resolved truth.
     */
    typeWhen?: ReadonlyArray<PayloadTypeWhen>;
    /** `.lolo` `T.f` / `[T.f]`: the declared field this value — each element's, for an array — was projected from. */
    projectedFrom?: FieldProjection;
    /** The element type of an `array` field whose element is itself a typed field (`[(Adv | string)]`). */
    items?: EventPayloadField;
};

const eventPayloadFieldShape = {
    /**
     * Field type. Mirrors the Rust validator's acceptance: any non-empty
     * string. Primitives ('string' | 'number' | 'boolean' | 'object' |
     * 'array') are the canonical values; entity-name references like
     * 'ModalRecord' and array-of-entity references like '[ModalRecord]'
     * are also valid because the Rust IR's PayloadField.field_type is
     * just a String. Only enforced narrowly at the call site (e.g.
     * emit-literal type-mismatch warnings in
     * orbital-compiler/phases/validation/emit_payload.rs) — not here.
     */
    type: z.string().min(1),
    required: z.boolean().optional(),
    nullable: z.boolean().optional(),
    additionalProperties: z.lazy(() => EventPayloadTypeMemberSchema).optional(),
    values: z.array(z.string()).optional(),
    description: z.string().optional(),
    entity: z.string().optional(),
    properties: z.lazy(() => z.array(EventPayloadFieldSchema)).optional(),
    typeWhen: z.array(PayloadTypeWhenSchema).optional(),
    projectedFrom: FieldProjectionSchema.optional(),
    items: z.lazy(() => EventPayloadTypeMemberSchema).optional(),
};

export const EventPayloadTypeMemberSchema: z.ZodType<EventPayloadField> = z.object({
    name: z.string(),
    ...eventPayloadFieldShape,
});

export const EventPayloadFieldSchema: z.ZodType<EventPayloadField> = z.object({
    name: z.string().min(1),
    ...eventPayloadFieldShape,
});

// ============================================================================
// Trait Event Contract
// ============================================================================

/**
 * Event contract for events a trait emits.
 * Declares the event name, scope, and payload schema.
 */
export type TraitEventContract = {
    /** Event name (UPPER_SNAKE_CASE) */
    event: string;
    /** V4 dual-carry id sibling of `event` — optional until the Phase-7 flip. */
    eventId?: EventId;
    /** Human-readable description */
    description?: string;
    /** User-vocabulary synonyms (comma-separated) — the per-event analogue of a
     *  field/config `@synonyms`. Feeds the curation event matcher. */
    synonyms?: string;
    /** Authoring tier (`essential`/`customization`/`advanced`/`internal`). */
    tier?: string;
    /**
     * The config knob whose value DEFINES this event's name, when the emit was
     * authored as `emits { @config.<knob> }`. Captured at L1, where the
     * `@config.X` spelling still exists — after inlining, `event` holds the
     * resolved literal and the fact that it came from a knob is otherwise
     * unrecoverable.
     *
     * A definer knob CREATES an event name rather than referencing one, which
     * is why consumers must not pin such a knob to the trait's existing event
     * vocabulary: doing so forbids the very name it exists to introduce.
     */
    definerKnob?: string;
    /**
     * `true` when `scope` was set by a CALL-SITE `emitsScope` override (the
     * inline phase applies it), not by the source atom's own `-> external`
     * declaration. An atom declaring its emits external is an unexamined
     * default (nearly every atom does), while a composition restating it is
     * the consumer's own deferral — the dead-control check honours it as an
     * exemption. See ORB-X-EXTERNAL-EMIT-EXEMPTION.
     */
    scopeOverridden?: boolean;
    /** Payload schema — declarative type info for the event's payload.
     *  Distinct from the runtime payload value (`@payload.X` bindings,
     *  `EventPayload`) which is a separate concept. */
    payloadSchema?: EventPayloadField[];
    /**
     * Same marker as `Event.payloadEntity` (`state-machine.ts`) — this
     * emit's payload was declared `type X = Event <EntityName>` and is a
     * flat mirror of that entity's fields. See that field's doc for the
     * full contract (G4, `Almadar_Compiler_Gaps.md` §82).
     */
    payloadEntity?: string;
    /**
     * Event scope:
     * - 'internal': Trait-to-trait within same orbital (default)
     * - 'external': Exposed for cross-orbital communication
     */
    scope?: EventScope;
};

/**
 * `@config.<knob>` is the only legal reference form for an emit/listen
 * event name (Option B — the declared event name resolves to a
 * `string`- or `event`-typed config knob's value at inline/resolve time).
 * Matches the Rust lexer's dotted-sigil body (`config.<ident>`, no further
 * dots).
 */
export const CONFIG_REF_EVENT_PATTERN = /^@config\.[A-Za-z_][A-Za-z0-9_]*$/;

/** Returns the knob identifier when `event` is a `@config.<knob>` reference, else `undefined`. */
export function configRefEventKnob(event: string): string | undefined {
    return CONFIG_REF_EVENT_PATTERN.test(event) ? event.slice('@config.'.length) : undefined;
}

/** Why a `@config.<knob>` emit/listen event-name reference failed to resolve. */
export type ConfigRefEventError = 'unknown-knob' | 'not-string' | 'no-default';

/**
 * Resolve a `@config.<knob>` emit/listen event-name reference to its
 * concrete literal, given the trait's declared config schema and the
 * effective config value map (call-site override folded over declared
 * default — same precedence the Rust inline phase's `effective_config`
 * uses). The single JS-side owner of this resolution rule; mirrors
 * `resolve_config_ref_event_name` in `orbital-core::schema` (Rust).
 * Returns the resolved literal, or the specific contract clause that failed.
 */
export function resolveConfigRefEventName(
    event: string,
    declaredConfig: DeclaredTraitConfig | undefined,
    effectiveConfig: Readonly<Record<string, TraitConfigValue>>,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: ConfigRefEventError } {
    const knob = configRefEventKnob(event);
    if (knob === undefined) return { ok: false, error: 'unknown-knob' };
    const field = declaredConfig?.[knob];
    if (field === undefined) return { ok: false, error: 'unknown-knob' };
    // A-UNIFY: definer knobs (whose value CREATES the event name) spell
    // `: event` same as reference knobs — the declared field type is
    // `'string' | 'event'`, the VALUE still must be a plain string literal.
    if (field.type !== 'string' && field.type !== 'event') return { ok: false, error: 'not-string' };
    if (field.default === undefined) return { ok: false, error: 'no-default' };
    const value = effectiveConfig[knob];
    if (typeof value !== 'string') return { ok: false, error: 'not-string' };
    return { ok: true, value };
}

export const TraitEventContractSchema = z.object({
    /**
     * Event name. Mirrors the Rust validator's `is_valid_event_identifier`:
     * starts with a letter, then any letters / digits / underscores. Both
     * UPPER_SNAKE_CASE and PascalCase shapes are valid identifiers in the
     * post-Phase 2.5 nominal-event type system (events declared via
     * `type X = Event<T>`). A pre-resolution `@config.<knob>` reference
     * (Option B) is also legal — inline/resolve substitutes it with the
     * knob's effective literal before codegen/runtime consume it.
     */
    event: z.string().min(1).regex(
        /^([A-Za-z][A-Za-z0-9_]*|@config\.[A-Za-z_][A-Za-z0-9_]*)$/,
        'Event name must start with a letter and contain only letters, digits, and underscores, or be a `@config.<knob>` reference'
    ),
    eventId: EventIdSchema.optional(),
    description: z.string().optional(),
    synonyms: z.string().optional(),
    tier: z.string().optional(),
    definerKnob: z.string().optional(),
    scopeOverridden: z.boolean().optional(),
    payloadSchema: z.array(EventPayloadFieldSchema).optional(),
    payloadEntity: z.string().optional(),
    scope: EventScopeSchema.optional(),
});

// ============================================================================
// Trait Event Listener
// ============================================================================

/**
 * Event listener for trait communication.
 * Guards can be legacy strings or S-expressions.
 * Enhanced with scope and payloadMapping for cross-orbital communication.
 */
/**
 * Source-scoping for a `listens {}` entry. Determines which emitters the
 * listener responds to.
 *
 * - `{ kind: "any" }`: wildcard (`* EVENT -> TRIGGER`). Any trait, any orbital.
 * - `{ kind: "trait", trait: "X" }`: intra-orbital (`X EVENT -> TRIGGER`).
 *   Only emits from the same orbital's trait `X`.
 * - `{ kind: "orbital", orbital: "O", trait: "X" }`: cross-orbital
 *   (`O.X EVENT -> TRIGGER`). Only emits from orbital `O`'s trait `X`.
 *
 * Absent (undefined) means the listener is a local payload-declaration only
 * — pure type metadata, no bus subscription.
 */
export type ListenSource =
    | { kind: 'any' }
    | {
        kind: 'trait';
        trait: string;
        /** V4 dual-carry id sibling of `trait` — optional until the Phase-7 flip. */
        traitId?: TraitId;
      }
    | {
        kind: 'orbital';
        orbital: string;
        trait: string;
        /** V4 dual-carry id sibling of `orbital` — optional until the Phase-7 flip. */
        orbitalId?: OrbitalId;
        /** V4 dual-carry id sibling of `trait` — optional until the Phase-7 flip. */
        traitId?: TraitId;
      };

export const ListenSourceSchema = z.union([
    z.object({ kind: z.literal('any') }),
    z.object({
        kind: z.literal('trait'),
        trait: z.string().min(1),
        traitId: TraitIdSchema.optional(),
    }),
    z.object({
        kind: z.literal('orbital'),
        orbital: z.string().min(1),
        trait: z.string().min(1),
        orbitalId: OrbitalIdSchema.optional(),
        traitId: TraitIdSchema.optional(),
    }),
]);

/**
 * Split a `listens`-addressed event (`EVENT`, `Trait.EVENT`, `*.EVENT`,
 * `Orbital.Trait.EVENT`) into the bare event and its source. The one parser of
 * the address form, shared by `listens` and event-typed values. Mirrors
 * `orbital-core` `split_event_address`.
 */
export function splitEventAddress(raw: string): { event: string; source?: ListenSource } {
    const parts = raw.split('.');
    if (parts.length <= 1) return { event: raw };
    if (parts.length === 2) {
        const [src, event] = parts;
        return src === '*'
            ? { event, source: { kind: 'any' } }
            : { event, source: { kind: 'trait', trait: src } };
    }
    const n = parts.length;
    return {
        event: parts[n - 1],
        source: { kind: 'orbital', orbital: parts.slice(0, n - 2).join('.'), trait: parts[n - 2] },
    };
}

/** Inverse of {@link splitEventAddress}. */
export function joinEventAddress(event: string, source?: ListenSource): string {
    if (source === undefined) return event;
    switch (source.kind) {
        case 'any':
            return `*.${event}`;
        case 'trait':
            return `${source.trait}.${event}`;
        case 'orbital':
            return `${source.orbital}.${source.trait}.${event}`;
    }
}

export type TraitEventListener = {
    /** Event key to listen for (bare event name, no source prefix in the new shape) */
    event: string;
    /** V4 dual-carry id sibling of `event` — optional until the Phase-7 flip. */
    eventId?: EventId;
    /** State machine event to trigger */
    triggers: string;
    /** V4 dual-carry id sibling of `triggers` — optional until the Phase-7 flip. */
    triggersId?: EventId;
    /** Human-readable description (authored `@description` on the listen). */
    description?: string;
    /** User-vocabulary synonyms (comma-separated). */
    synonyms?: string;
    /** Authoring tier (`essential`/`customization`/`advanced`/`internal`). */
    tier?: string;
    /** Guard expression - string (legacy) or S-expression array */
    guard?: Expression;
    /**
     * Listener scope:
     * - 'internal': Listen to events within same orbital (default)
     * - 'external': Listen to events from other orbitals
     */
    scope?: EventScope;
    /**
     * `with { ... }` payload rewrite: `{ targetField: SExpr }`. Each value is a
     * full s-expression evaluated against the source payload — a `@payload.<field>`
     * read, a literal, or an operator list. The kernel applies it
     * (`applyListenMapping` crosses into it).
     */
    payloadMapping?: Record<string, SExpr>;
    /**
     * Source scoping (see `ListenSource`). Undefined when the listen entry is
     * a local payload declaration rather than a bus subscription.
     */
    source?: ListenSource;
};

export const TraitEventListenerSchema = z.object({
    event: z.string().min(1),
    eventId: EventIdSchema.optional(),
    triggers: z.string().min(1),
    triggersId: EventIdSchema.optional(),
    description: z.string().optional(),
    synonyms: z.string().optional(),
    tier: z.string().optional(),
    guard: ExpressionSchema.optional(),
    scope: EventScopeSchema.optional(),
    payloadMapping: z.record(SExprSchema).optional(),
    source: ListenSourceSchema.optional(),
});

// ============================================================================
// Required Field
// ============================================================================

/**
 * Field required by a trait from its linkedEntity
 */
export type RequiredField = {
    name: string;
    type: TraitFieldType;
    description?: string;
};

export const RequiredFieldSchema = z.object({
    name: z.string().min(1),
    type: z.union([z.enum(TRAIT_FIELD_TYPES), TypeVariableSchema]),
    description: z.string().optional(),
});

// ============================================================================
// Trait Reference
// ============================================================================

/**
 * Reference to a trait from an entity or page.
 *
 * Phase F treats a trait reference as a function call: `ref` names the
 * imported trait and the sibling fields are arguments. The compiler's
 * identifier-substitution pass uses these arguments to rewrite the
 * inlined trait clone before lowering.
 */
export type TraitReference = {
    ref: string;
    /** V4 dual-carry id sibling of `ref` — optional until the Phase-7 flip. */
    refId?: TraitId;
    /**
     * V4 LOCAL DECLARATION id — the identity of this trait AS DECLARED in its
     * orbital (`trait X = Alias.traits.Y` declares node X; `refId` carries
     * Y's id). Minted by the stamp so page trait refs and `@trait.X` embeds
     * resolve by id across `name:` renames (the composed-organism surface was
     * the one declaration class without an id).
     */
    id?: TraitId;
    /**
     * Phase 1.2: optional registry path disambiguator. Pairs with `ref` to
     * explicitly name which `uses` entry the alias was imported from
     * (e.g. "std/behaviors/atoms/std-browse"). Helpful for programmatic
     * descriptor construction and inline-phase disambiguation when multiple
     * registries expose the same alias prefix.
     */
    from?: string;
    linkedEntity?: string;
    /** V4 dual-carry id sibling of `linkedEntity` — optional until the Phase-7 flip. */
    linkedEntityId?: EntityId;
    /** Phase F: rename the inlined trait at the call site */
    name?: string;
    /** Phase F: rename atom event keys at the call site, e.g. {OPEN: "ADD_ITEM"} */
    events?: Record<string, string>;
    /**
     * 3-II trait type-parameter arguments (`:: p SomeType` in `.lolo`):
     * declared-param name → type-vocabulary name (an entity, a primitive incl.
     * `scalar`, or a struct alias from the AUTHORING file's `types` map).
     * Present on pre-inline registry references only — the inline phase
     * consumes it while resolving `$<name>` payload sentinels and it never
     * appears in a final composed `.orb`.
     */
    typeArgs?: Record<string, string>;
    /** Preprocess-output carrier: the fully resolved trait this reference stands
     *  for (`@almadar/runtime` `preprocessSchema` output only; never in a `.orb`). */
    _resolved?: Trait;
    /** V4 dual-carry id sibling of `events` (keys = baked event names resolved to ids) — optional until the Phase-7 flip. */
    eventIds?: Record<string, EventId>;
    /**
     * Entity-field remap: rewrite the inlined trait's canonical `@entity.X` /
     * `@payload.row.X` field references to the consumer entity's field names,
     * e.g. `{ name: "title", folder: "parentId" }`. Mirrors `events` for
     * fields. Applied during inline substitution alongside `linkedEntity`.
     */
    fields?: Record<string, string>;
    /**
     * Call-site config overrides. Each entry is either a plain wiring value
     * (`TraitConfigValue`) or a fully-annotated re-declaration
     * (`ConfigFieldDeclaration` with `type`, optional `label`/`description`/
     * `synonyms`/`tier`). Use `isCallSiteConfigDeclaration` to discriminate.
     *
     * Plain wiring (existing callers): `config: { icon: "star", count: 5 }`.
     * Annotated (new): `config: { icon: { type: "string", default: "star",
     *   label: "Icon", tier: "presentation" } }`.
     */
    config?: CallSiteConfig;
    appliesTo?: string[];
    /**
     * Phase F.7: replace the imported trait's `listens` array with the
     * caller-supplied list. Empty array clears all upstream listens. The
     * inliner applies this AFTER substitution, overwriting whatever the
     * upstream declared. Use sparingly: this drops external event wiring.
     */
    listens?: TraitEventListener[];
    /**
     * Phase F.7: set every emit's `scope` to the caller-supplied value.
     * `'internal'` confines emits to the orbital's internal bus; `'external'`
     * broadcasts them. Applied after substitution and listens replacement.
     */
    emitsScope?: 'internal' | 'external';
    /**
     * Phase F.8: per-transition effects override. The map's keys are event
     * names (the transition triggers, AFTER any rename via `events`). The
     * values are the SExpression effect lists that REPLACE the matching
     * transitions' `effects[]` arrays.
     *
     * This is the unified content + effect override mechanism. Whether the
     * override list contains `["render-ui", ...]` (visual content),
     * `["fetch", ...]` (data load), `["persist", ...]` (mutation), or any
     * combination, the inliner just substitutes the whole list. Identifier
     * substitution (entity refs, event refs) still runs over the merged
     * trait body, so override effects can use either upstream or caller
     * identifiers and the F.3 walker will rewrite them consistently.
     *
     * Example:
     * ```json
     * "effects": {
     *   "ADD_ITEM": [
     *     ["fetch", "CartItem"],
     *     ["render-ui", "main", { ... }]
     *   ],
     *   "SAVE": [
     *     ["persist", "create", "CartItem", "@payload.data"]
     *   ]
     * }
     * ```
     */
    effects?: Record<string, SExpr[]>;
};

/** The reference object's fields, before the `events` refinement (so other shapes can `.pick` from it). */
export const TraitReferenceObjectSchema = z
    .object({
        ref: z.string().min(1),
        refId: TraitIdSchema.optional(),
        // V4 local declaration id (see the interface doc) — declared so the
        // strip-mode zod gate carries it through instead of dropping it.
        id: TraitIdSchema.optional(),
        // Phase 1.2: optional registry path disambiguator, pairs with `ref`.
        from: z.string().optional(),
        linkedEntity: z.string().optional(),
        linkedEntityId: EntityIdSchema.optional(),
        name: z.string().optional(),
        events: z
            .record(
                z.string().min(1, "events key (atom event name) must be non-empty"),
                z.string().min(1, "events value (caller event name) must be non-empty"),
            )
            .optional(),
        eventIds: z.record(z.string().min(1), EventIdSchema).optional(),
        _resolved: z.lazy(() => TraitSchema).optional(),
        // 3-II type-parameter arguments (see `TraitReference.typeArgs`).
        typeArgs: z
            .record(
                z.string().min(1, "typeArgs key (declared param name) must be non-empty"),
                z.string().min(1, "typeArgs value (type name) must be non-empty"),
            )
            .optional(),
        fields: z
            .record(
                z.string().min(1, "fields key (canonical field name) must be non-empty"),
                z.string().min(1, "fields value (consumer field name) must be non-empty"),
            )
            .optional(),
        // Each value is either a plain wiring value (TraitConfigValue) or an
        // annotated ConfigFieldDeclaration. Declaration form is tried first
        // (it's more specific — has a `"type"` string key); plain values fall
        // through to the recursive TraitConfigValue union.
        config: z.record(z.union([ConfigFieldDeclarationSchema, TraitConfigValueSchema])).optional(),
        appliesTo: z.array(z.string()).optional(),
        // Phase F.7: caller-supplied listen entries are already-resolved
        // structured definitions (see `TraitReference.listens`).
        listens: z.array(TraitEventListenerSchema).optional(),
        emitsScope: z.enum(['internal', 'external']).optional(),
        // Phase F.8: per-transition effects override. The keys are event
        // names (the transition triggers AFTER renames); values are SExpr
        // effect tuples.
        effects: z
            .record(
                z.string().min(1, "effects override key (event name) must be non-empty"),
                z.array(SExprSchema),
            )
            .optional(),
    });

export const TraitReferenceSchema = TraitReferenceObjectSchema
    .refine(
        (ref) => {
            if (!ref.events) return true;
            // Phase F.4: reject empty event-name strings on either side of
            // every entry. The substitution pass treats empty strings as
            // no-ops at runtime, but accepting them at the schema boundary
            // hides authoring errors. The per-entry .min(1) above already
            // rejects most cases; this refine is the belt-and-braces check
            // that survives any future relaxation of the inner validators.
            for (const [from, to] of Object.entries(ref.events)) {
                if (from.length === 0 || to.length === 0) return false;
            }
            return true;
        },
        {
            message:
                'TraitReference "events" entries must have non-empty atom and caller event names',
            path: ["events"],
        },
    );

/**
 * Simplified trait reference - supports string, reference object, or inline Trait definition
 * - string: "TraitName" - reference to a trait by name
 * - { ref: "TraitName" }: reference object with optional config / overrides
 * - { name: "TraitName", stateMachine: {...} }: inline trait definition
 *
 * Phase F adds `name` and `events` to the reference object form so callers
 * can rename the trait and remap atom event keys.
 */
/** A trait in an orbital: a bare name, a reference (the full `TraitReference` the wire carries), or an inline trait. */
export type TraitRef = string | TraitReference | Trait;

// TraitRefSchema is defined after TraitSchema (see below) to avoid forward reference

// ============================================================================
// Trait UI Binding
// ============================================================================

export type PresentationType = 'modal' | 'drawer' | 'popover' | 'inline' | 'confirm-dialog';

export type TraitUIBinding = {
    [stateName: string]: {
        presentation: PresentationType;
        content: AnyPatternConfig | AnyPatternConfig[];
        props?: {
            size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
            position?: 'left' | 'right' | 'top' | 'bottom' | 'center';
            title?: string;
            closable?: boolean;
            width?: string;
            showProgress?: boolean;
            step?: number;
            totalSteps?: number;
        };
    };
};

/**
 * Zod schema for {@link TraitUIBinding}. `content` is a pattern config (or
 * list of them), validated as pattern objects by {@link PatternObjectSchema}
 * (the registry checks props at validate time).
 */
export const TraitUIBindingSchema = z.record(
    z.object({
        presentation: z.enum(['modal', 'drawer', 'popover', 'inline', 'confirm-dialog']),
        content: z.union([PatternObjectSchema, z.array(PatternObjectSchema)]),
        props: z
            .object({
                size: z.enum(['sm', 'md', 'lg', 'xl', 'full']).optional(),
                position: z.enum(['left', 'right', 'top', 'bottom', 'center']).optional(),
                title: z.string().optional(),
                closable: z.boolean().optional(),
                width: z.string().optional(),
                showProgress: z.boolean().optional(),
                step: z.number().optional(),
                totalSteps: z.number().optional(),
            })
            .optional(),
    }),
);

// ============================================================================
// Trait Definition
// ============================================================================

/**
 * A Trait is a reusable behavioral module with state machine.
 *
 * Traits declare their event contracts via `emits` and `listens`:
 * - `emits`: Events this trait can emit (with scope and payload schema)
 * - `listens`: Events this trait listens for (with optional payloadMapping)
 */
/**
 * Instance vs collection scope for a trait.
 *
 * Mirrors the `.lolo` trait modifier list (`[interaction, instance]` /
 * `[interaction, collection]`). Instance traits own a single entity record
 * (typed by `linkedEntity`) and read/write `@entity.field`. Collection
 * traits render records of `linkedEntity` without owning any one; data flows
 * through `@payload.data` typed as `Array<linkedEntity>`.
 *
 * Optional today. A future phase (Almadar_Entity_V2_Plan.md Phase 4) makes
 * it required and adds static checks in the compiler.
 */
export type TraitScope = 'instance' | 'collection';

export const TraitScopeSchema = z.enum(['instance', 'collection']);

/**
 * Inferred field contract for a `@rebindable` trait binding. `requires` =
 * entity fields the trait READS via `@entity.<field>`; `provides` = fields it
 * WRITES via `(set @entity.<field> ...)`. A consumer that rebinds the trait
 * (`linkedEntity`) must point at an entity whose fields ⊇ `requires`. Inferred
 * by the lolo lowerer from the trait's own SExpr usage; the orbital-rust L2
 * validator enforces it (`ORB_T_REBIND_MISSING_FIELDS`). Mirrors the Rust
 * `EntityFieldContract` serde shape exactly.
 */
export type EntityFieldContract = {
    requires: string[];
    provides: string[];
};

export const EntityFieldContractSchema = z.object({
    requires: z.array(z.string()),
    provides: z.array(z.string()),
});

/**
 * Where in a trait an effect is declared. The distinction is load-bearing: a
 * `render-ui` in a transition fires when that transition fires, but one inside a
 * `ticks` block repaints every frame, so two tick writers on one slot paint
 * together where two transition writers routinely alternate.
 */
export type EffectSite = 'transition' | 'tick';

export const EffectSiteSchema = z.enum(['transition', 'tick']);

/**
 * One effect a trait produces, with the resource it acts on — the slot for
 * `render-ui`, the entity for `persist`/`fetch`, the event for `emit`, the
 * binding path for `set`. `resource` is recorded verbatim as authored; when the
 * author deferred it to a call site (`@config.surface`) the reference is kept as
 * written and `resolved` is false. Mirrors the Rust `EffectUse` serde shape.
 */
export type EffectUse = {
    kind: string;
    resource?: string;
    /** Absent means true — only an unresolved `@config.*` resource sets it. */
    resolved?: boolean;
    /** Absent means `'transition'`. */
    site?: EffectSite;
};

export const EffectUseSchema = z.object({
    kind: z.string(),
    resource: z.string().optional(),
    resolved: z.boolean().optional(),
    site: EffectSiteSchema.optional(),
});

/**
 * Every effect a trait produces — what composing it actually brings along.
 *
 * Inferred by the lolo lowerer from the trait's own effects (never authored, the
 * way {@link EntityFieldContract} is never authored), then re-derived
 * post-inline once call-site config makes `@config.*` resources concrete. A
 * trait's type used to say nothing about its effects, which is why "is this safe
 * to compose?" could only be answered by reading the atom.
 */
export type EffectRow = EffectUse[];

export const EffectRowSchema = z.array(EffectUseSchema);

/**
 * Client dispatch strategy for a trait's transitions — the ONE rule,
 * computed from declared facts only, never inferred from a trait's effects
 * (`docs/Almadar_LOLO.md` §7). Mirrors `orbital-core`'s
 * `runtime::dispatch_mode::DispatchMode` serde shape exactly (the enum both
 * `OirTrait::dispatch_mode` (compiled path) and `TraitDefinition::dispatch_mode`
 * (runtime kernel) return) — same variant spellings, so a value round-trips
 * on the wire unchanged.
 */
export type DispatchMode = 'persistedAwaited' | 'hybridClientOnly' | 'runtimeOptimistic';

export const DispatchModeSchema = z.enum(['persistedAwaited', 'hybridClientOnly', 'runtimeOptimistic']);

export type Trait = {
    /** V4 dual-carry id sibling of `name` — optional until the Phase-7 flip. */
    id?: TraitId;
    name: string;
    description?: string;
    description_visual_prompt?: string;
    category?: TraitCategory;
    /**
     * Opt-in marker authored as `-> @rebindable Entity` in `.lolo`. When
     * `true`, a consuming molecule/organism may rebind this trait's entity via
     * `linkedEntity`; otherwise the binding is fixed and the validator rejects
     * any rebind (`ORB_T_ENTITY_NOT_REBINDABLE`). Absent on traits that don't
     * bind an entity.
     */
    entityRebindable?: boolean;
    /**
     * Inferred field contract a rebind target must satisfy. Emitted only
     * alongside `entityRebindable: true`. See {@link EntityFieldContract}.
     */
    entityContract?: EntityFieldContract;
    /**
     * Inferred effect surface. Absent on traits that produce no effects at all.
     * See {@link EffectRow}.
     */
    effectRow?: EffectRow;
    /**
     * `@description "..."` authored on the `@rebindable` binding in `.lolo`.
     * Surfaced to catalog prose + knob-embeddings so the LLM can reach for the
     * binding from intent vocabulary (binding-discovery). Absent when unmarked.
     */
    entityBindingDescription?: string;
    /** `@synonyms "..."` authored on the `@rebindable` binding in `.lolo`. */
    entityBindingSynonyms?: string;
    /**
     * Author-supplied capability tags lifted from the `.lolo` trait header's
     * bracket list. Anything beyond the known scope tokens (`instance` /
     * `collection`) and the first category identifier accumulates here.
     * Free-form strings — the lolo parser does not validate them against a
     * known set. The Phase 4 translator overlay matches rules to traits by
     * exact set membership against this list. Empty when no capabilities
     * were declared. See `docs/Almadar_Domain_Language.md` Phase 3.
     */
    capabilities?: string[];
    /**
     * Instance or collection scope. Required in V2: every trait operates on
     * either a single record (`instance`) or a group (`collection`). Drives
     * payload-inference rules for emits declared via `type X = Event<T>` and
     * shapes the runtime's binding semantics. Authored in `.lolo` as the
     * `[instance]` / `[collection]` modifier on the trait header.
     */
    scope: TraitScope;
    /**
     * `local` trait-header flag — declares client-only dispatch. Authored in
     * `.lolo` as the `local` modifier on the trait header (`[interaction, instance, local]`).
     * Undeclared (`undefined`) means server-gated dispatch. Mirrors the Rust
     * `OirTrait::local` field; never inferred from effects.
     */
    local?: boolean;
    /**
     * The entity this trait is linked to.
     * Required for inline trait definitions within an orbital.
     */
    linkedEntity?: string;
    /** V4 dual-carry id sibling of `linkedEntity` — optional until the Phase-7 flip. */
    linkedEntityId?: EntityId;
    /**
     * V4 leverage-ids — id side-map for `@entity.<Name>` binding tokens + positional
     * entity args (`fetch`/`ref`/`persist`/`spawn`) in this trait's guards/effects/
     * ticks/listens. Maps the referenced entity NAME → its stable id, so readers
     * resolve these bare-string positions by id (else name) and an entity rename never
     * strands them — the coverage that lets the entity name-rewriter be deleted.
     */
    entityRefIds?: Record<string, EntityId>;
    /**
     * V4 leverage-ids — id side-map for `@trait.<Name>` embed tokens (render-ui embeds /
     * effect-tree sibling refs). Maps the embed token NAME → the embedded trait's stable
     * id, so readers splice embeds by id (else name) — the coverage that lets the
     * `@trait.` name-rewriter be deleted.
     */
    traitEmbedIds?: Record<string, TraitId>;
    requiredFields?: RequiredField[];
    dataEntities?: TraitDataEntity[];
    stateMachine?: StateMachine;
    initialEffects?: Effect[];
    ticks?: TraitTick[];
    /**
     * Events this trait emits.
     * Each event can be scoped as internal or external.
     * External events are namespaced at orbital level (TraitName.EVENT_NAME).
     */
    emits?: TraitEventContract[];
    /**
     * Events this trait listens for.
     * External listeners reference namespaced events (TraitName.EVENT_NAME).
     */
    listens?: TraitEventListener[];
    /**
     * `events { ACTION: CONFIRM_VOID }` — the call-site rename map that binds a
     * pattern's own event slot (the key, e.g. a Button's `ACTION`) to the app
     * event it fires (the value). Emitted into the IR by the inliner and read
     * by wiring analysis: without it, an affordance whose event lives here
     * rather than in the render payload looks like it fires nothing.
     */
    events?: Readonly<Record<string, string>>;
    ui?: TraitUIBinding;
    /**
     * Declared `config { }` schema authored on the trait. Drives
     * `@config.X` substitution: each field's `default` seeds the
     * binding context behind any caller-supplied call-site
     * `config: { ... }` override.
     */
    config?: DeclaredTraitConfig;
    /**
     * Set by the resolve/inline phase when this trait was cloned from a
     * `uses[]` import. Absent for traits authored directly on the
     * orbital. Viewport-only metadata — runtime and codegen ignore it.
     * Drives Studio's L2 grouping (imported traits collapse under one
     * card per alias) and L3 drill (alias → that behavior's transitions).
     */
    sourceBehavior?: SourceBehaviorMetadata;
    sourceDeclaration?: SourceDeclarationMetadata;
    /**
     * Set by the resolve/inline phase alongside `sourceBehavior`. Carries
     * the resolved `Entity` definition of the imported behavior so the
     * client-side mock-data generator can produce rows for the trait's
     * `linkedEntity` without re-walking the import graph at runtime.
     */
    sourceEntityDefinition?: Entity;
    /**
     * Increment 3-II: this trait's own declared type parameters. Present
     * only on an atom's DECLARING inline trait (never authored on a
     * reference); survives cloning into a consumer's composed schema.
     */
    typeParams?: TraitTypeParamDef[];
};

/**
 * Provenance attached to a trait that was cloned from a `uses[]` import
 * during the inline phase. The resolved schema carries this so Studio
 * can group L2 cards by source behavior and offer an L3 drill into the
 * import's own transitions.
 */
export type SourceBehaviorMetadata = {
    /** Behavior name (e.g. "std-stat-card") — the resolved `from:` value. */
    behavior: string;
    /** Alias used at the import site (e.g. "Stat"). Multiple imports of
     *  the same atom group by alias, not by behavior. */
    alias: string;
    /** Original trait name inside the imported behavior, before any
     *  call-site `name:` rename. */
    originalName: string;
};

export type SourceDeclarationMetadata = {
    traitId: string;
    fingerprint: string;
};

export const SourceDeclarationMetadataSchema = z.object({
    traitId: z.string().min(1),
    fingerprint: z.string().min(1),
});

export const SourceBehaviorMetadataSchema = z.object({
    behavior: z.string().min(1),
    alias: z.string().min(1),
    originalName: z.string().min(1),
});

/**
 * One trait-level type parameter — `(V : Type, R : Type)` in
 * `trait Name (V : Type, R : Type) -> Entity { ... }`. Present only on an
 * atom's DECLARING inline trait; survives cloning into a consumer's composed
 * schema so the inline phase can read each param's `kind` when resolving a
 * surviving `"$<name>"` payload sentinel. `kind` is one of the six alias
 * type-parameter kind names (`Type`, `Entity`, `Trait`, `Page`, `Orbital`,
 * `Event`) — in practice `Type` and `Entity` are the two meaningful kinds
 * for a trait param today.
 */
export type TraitTypeParamDef = {
    name: string;
    kind: string;
    /**
     * Declaration default (`(r : Type = <name>)`) — a primitive name (incl.
     * `scalar`), an entity name, or a struct-alias name, all resolved in
     * the atom's own file. Consulted only when no call-site `::` arg was
     * supplied (and, for Entity-kind, only when `linkedEntity` also gave no
     * default).
     */
    default?: string;
};

export const TraitTypeParamDefSchema: z.ZodType<TraitTypeParamDef> = z.object({
    name: z.string().min(1),
    kind: z.string().min(1),
    default: z.string().optional(),
});

export const TraitSchema = z.object({
    id: TraitIdSchema.optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    description_visual_prompt: z.string().optional(),
    category: TraitCategorySchema.optional(),
    entityRebindable: z.boolean().optional(),
    entityContract: EntityFieldContractSchema.optional(),
    effectRow: EffectRowSchema.optional(),
    entityBindingDescription: z.string().optional(),
    entityBindingSynonyms: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    scope: TraitScopeSchema,
    /** `local` trait-header flag — declares client-only dispatch (mirrors Rust `OirTrait::local`). Undeclared = server-gated dispatch. */
    local: z.boolean().optional(),
    linkedEntity: z.string().optional(),
    linkedEntityId: EntityIdSchema.optional(),
    entityRefIds: z.record(z.string().min(1), EntityIdSchema).optional(),
    traitEmbedIds: z.record(z.string().min(1), TraitIdSchema).optional(),
    requiredFields: z.array(RequiredFieldSchema).optional(),
    dataEntities: z.array(TraitDataEntitySchema).optional(),
    stateMachine: StateMachineSchema.optional(),
    initialEffects: z.array(EffectSchema).optional(),
    ticks: z.array(TraitTickSchema).optional(),
    emits: z.array(TraitEventContractSchema).optional(),
    listens: z.array(TraitEventListenerSchema).optional(),
    /** Call-site rename map (`events { ACTION: CONFIRM_VOID }`) — mirrors `Trait.events`. */
    events: z.record(z.string().min(1), z.string().min(1)).optional(),
    ui: TraitUIBindingSchema.optional(),
    config: DeclaredTraitConfigSchema.optional(),
    sourceBehavior: SourceBehaviorMetadataSchema.optional(),
    sourceDeclaration: SourceDeclarationMetadataSchema.optional(),
    sourceEntityDefinition: EntitySchema.optional(),
    typeParams: z.array(TraitTypeParamDefSchema).optional(),
});

// TraitRefSchema defined here after TraitSchema to avoid forward reference.
//
// The reference arm IS `TraitReferenceSchema` — one schema for one shape. It
// used to be a narrower hand-rolled copy (`ref`/`config`/`linkedEntity`/`name`/
// `events` only), and because `z.object()` STRIPS undeclared keys rather than
// rejecting them, every `.orb` that came through the loader's `safeParse` lost
// `id`, `refId`, `linkedEntityId`, `listens`, `emitsScope`, `effects`, `fields`
// and `eventIds` on every trait ref — silently, with a schema that reported
// success. An atom's own sub-view refs (`trait DenseTableView =
// TableView.traits.TableViewRender -> BrowseItem { listens {…} }`) arrived with
// no listens at all, so the interpreted path could not wire what the compiled
// path wires from the same file.
export const TraitRefSchema = z.union([
    z.string().min(1),
    TraitReferenceSchema,
    TraitSchema, // Allow inline trait definitions
]);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a trait ref is an inline Trait definition
 */
/**
 * Checks if a trait reference is an inline trait definition.
 * 
 * Type guard to determine if a TraitRef is an inline trait object
 * (with 'name' property) rather than a string reference or object reference.
 * 
 * @param {TraitRef} traitRef - Trait reference to check
 * @returns {boolean} True if traitRef is an inline trait, false otherwise
 * 
 * @example
 * isInlineTrait({ name: 'MyTrait' }); // returns true (inline)
 * isInlineTrait('MyTrait'); // returns false (string reference)
 * isInlineTrait({ ref: 'MyTrait' }); // returns false (object reference)
 */
export function isInlineTrait(traitRef: TraitRef): traitRef is Trait {
    return typeof traitRef === 'object' && 'name' in traitRef && !('ref' in traitRef);
}

/**
 * Extracts the trait name from a trait reference.
 * 
 * Handles all trait reference formats (string, inline object, object reference)
 * and returns the canonical trait name.
 * 
 * @param {TraitRef} traitRef - Trait reference to extract name from
 * @returns {string} Trait name
 * 
 * @example
 * getTraitName('MyTrait'); // returns 'MyTrait'
 * getTraitName({ name: 'MyTrait' }); // returns 'MyTrait'
 * getTraitName({ ref: 'MyTrait' }); // returns 'MyTrait'
 */
export function getTraitName(traitRef: TraitRef): string {
    if (typeof traitRef === 'string') {
        return traitRef;
    }
    if (isInlineTrait(traitRef)) {
        return traitRef.name;
    }
    return traitRef.ref;
}

/**
 * Extracts the configuration from a trait reference.
 * 
 * Returns the configuration object for trait references that support it
 * (object references with 'config' property). Returns undefined for
 * string references and inline traits.
 * 
 * @param {TraitRef} traitRef - Trait reference to extract config from
 * @returns {TraitConfig | undefined} Trait configuration or undefined
 *
 * @example
 * getTraitConfig('MyTrait'); // returns undefined
 * getTraitConfig({ name: 'MyTrait' }); // returns undefined
 * getTraitConfig({ ref: 'MyTrait', config: { option: 'value' } }); // returns config object
 */
export function getTraitConfig(traitRef: TraitRef): CallSiteConfig | undefined {
    if (typeof traitRef === 'string') {
        return undefined;
    }
    if (isInlineTrait(traitRef)) {
        return undefined; // Inline traits don't have config
    }
    return traitRef.config;
}

/**
 * Normalizes a trait reference to object form.
 * 
 * Converts any trait reference format (string, inline, object) to a
 * standardized object format with 'ref' and optional 'config' properties.
 * 
 * @param {TraitRef} traitRef - Trait reference to normalize
 * @returns {{ ref: string; config?: TraitConfig }} Normalized trait reference
 *
 * @example
 * normalizeTraitRef('MyTrait'); // returns { ref: 'MyTrait' }
 * normalizeTraitRef({ name: 'MyTrait' }); // returns { ref: 'MyTrait' }
 * normalizeTraitRef({ ref: 'MyTrait', config: {...} }); // returns original
 */
export function normalizeTraitRef(traitRef: TraitRef): { ref: string; config?: CallSiteConfig } {
    if (typeof traitRef === 'string') {
        return { ref: traitRef };
    }
    if (isInlineTrait(traitRef)) {
        return { ref: traitRef.name };
    }
    return traitRef;
}

// ============================================================================
// Type exports
// ============================================================================

export type TraitInput = z.input<typeof TraitSchema>;
export type TraitReferenceInput = z.input<typeof TraitReferenceSchema>;

// Backward compatibility aliases
export type OrbitalTraitRef = TraitRef;
export const OrbitalTraitRefSchema = TraitRefSchema;
