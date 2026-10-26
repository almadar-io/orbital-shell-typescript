/**
 * Entity Types for Orbital Units
 *
 * Defines the OrbitalEntity type - the nucleus of an Orbital Unit.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { EntityIdSchema } from './identity.js';
import type { EntityId } from './identity.js';
import { EntityFieldSchema, type EntityField, type FileValue } from './field.js';
import { SemanticAssetRefSchema, type SemanticAssetRef } from './asset.js';
import { JsonValueSchema, type RuntimeValue } from './json.js';
import { SExprListSchema, SExprSchema, type SExpr } from './expression.js';

// ============================================================================
// Entity Persistence
// ============================================================================

/**
 * Entity persistence types.
 *
 * - persistent: Stored in database (has collection)
 * - runtime: Exists only at runtime (not persisted)
 */
export type EntityPersistence = 'persistent' | 'runtime';

export const EntityPersistenceSchema = z.enum([
    'persistent',
    'runtime',
]);

// ============================================================================
// Orbital Entity
// ============================================================================

/**
 * OrbitalEntity - the nucleus of an Orbital Unit.
 *
 * This is a simplified entity definition optimized for orbital composition.
 * Collection names are derived automatically from persistence type if not provided.
 */
export type OrbitalEntity = {
    /** V4 dual-carry id sibling of `name` — optional until the Phase-7 flip. */
    id?: EntityId;

    /** Entity name (PascalCase, e.g., "Task", "User") */
    name: string;

    /** Entity persistence type (defaults to 'persistent' if not specified) */
    persistence?: EntityPersistence;

    /** Whether this entity's state is shared across all bound traits (vs per-trait copy). Orthogonal to persistence. */
    shared?: boolean;

    /**
     * Whether this entity types the ambient `@user` viewer. Orthogonal to both
     * `persistence` and `shared`: `[persistent: people, identity]` is an
     * app-owned user directory, `[runtime, identity]` the provider-supplied
     * current viewer. At most one per composed program.
     */
    identity?: boolean;

    /**
     * `[persistent: x, browser]` — the rows live in the browser (IndexedDB), so
     * `fetch`/`persist` on this entity run client-side on both paths. Orthogonal
     * like `shared`; meaningful only on a persistent entity.
     */
    browser?: boolean;

    /**
     * `[store: Driver]` — the store-driver orbital that answers this entity's row
     * asks (EXEC-STORE-4); wins over the app's `store`.
     */
    store?: string;

    /**
     * `@read` — a per-row predicate (`@entity` = candidate row, `@user` =
     * viewer) ANDed with any call-site `filter:`. The un-bypassable twin of
     * `filter:`, enforced once for every trait that fetches this entity.
     */
    read_policy?: SExpr;

    /** `@create` — `@entity` binds the incoming data about to become a row. */
    create_policy?: SExpr;

    /** `@update` — `@entity` binds the existing row before mutation. */
    update_policy?: SExpr;

    /** `@delete` — same binding shape as `@update`. */
    delete_policy?: SExpr;

    /**
     * `@<op> none "<reason>"` — a directive's omission, DECLARED.
     *
     * Runtime behaviour is identical to leaving the directive out (an absent
     * policy is allow-all). It records that the author concluded no per-row
     * predicate can express the rule — usually because visibility depends on a
     * DIFFERENT entity, which a per-row predicate cannot join across. Without
     * it a lint must flag considered and forgotten omissions alike, and a lint
     * that flags correct code is one people learn to ignore.
     */
    access_waivers?: {
        read?: string;
        create?: string;
        update?: string;
        delete?: string;
    };

    /** `@invariant <expr>`: every stored row satisfies each, proved by `orb validate` over the program's writes. No runtime effect. */
    invariants?: SExpr[];

    /** `@index { fields, orderBy? }`: declared access paths. A path changes a query's cost, never its result. */
    indexes?: { fields: string[]; orderBy?: string }[];

    /** Collection name (auto-derived if not provided for persistent entities) */
    collection?: string;

    /** Entity fields */
    fields: EntityField[];

    /** Pre-authored instances (seed data or static reference data) */
    instances?: EntityRow[];

    /**
     * A browser-stored entity's first rows per locale (`instances ar [ … ]`),
     * keyed by a declared locale; a locale with no block takes `instances`.
     */
    localeInstances?: Record<string, EntityRow[]>;

    /** Auto-add createdAt/updatedAt timestamps */
    timestamps?: boolean;

    /** Soft delete support */
    softDelete?: boolean;

    /** Human-readable description */
    description?: string;

    /** Visual prompt for AI generation */
    visual_prompt?: string;

    /** Semantic asset reference for visual representation (games) */
    assetRef?: SemanticAssetRef;
};

export const OrbitalEntitySchema = z.object({
    name: z.string().min(1, 'Entity name is required'),
    // V4 arena id (`EntityDefinition.id`); declared so the strip-mode zod gate
    // carries an imported entity's id through instead of erasing it.
    id: EntityIdSchema.optional(),
    persistence: EntityPersistenceSchema.default('persistent'),
    shared: z.boolean().optional(),
    // Must stay in step with the Rust serde field (`EntityDefinition.identity`,
    // orbital-core/src/schema/types.rs). `z.object()` STRIPS unknown keys rather
    // than rejecting them, so a Rust-only field works on the compiled path and
    // silently vanishes on the interpreter path.
    identity: z.boolean().optional(),
    // Rust twin: `EntityDefinition.browser`.
    browser: z.boolean().optional(),
    // Rust twin: `EntityDefinition.store`.
    store: z.string().min(1).optional(),
    // Same "must stay in step with Rust serde" hazard as `identity` above —
    // these four mirror `EntityDefinition.{read,create,update,delete}_policy`.
    // Rust has no `rename_all` on this struct, so the wire key IS snake_case
    // (unlike this file's other camelCase fields, which are Rust-side-absent
    // and so never hit this cross-language constraint — see `visual_prompt`
    // just below for the existing precedent).
    read_policy: SExprSchema.optional(),
    create_policy: SExprSchema.optional(),
    update_policy: SExprSchema.optional(),
    delete_policy: SExprSchema.optional(),
    // Snake_case for the same cross-language reason as the four policies above.
    access_waivers: z
        .object({
            read: z.string().optional(),
            create: z.string().optional(),
            update: z.string().optional(),
            delete: z.string().optional(),
        })
        .optional(),
    invariants: SExprListSchema.optional(),
    indexes: z.array(z.object({ fields: z.array(z.string()), orderBy: z.string().optional() }).strict()).optional(),
    collection: z.string().optional(),
    fields: z.array(EntityFieldSchema),
    instances: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    localeInstances: z.record(z.string(), z.array(z.record(z.string(), JsonValueSchema))).optional(),
    timestamps: z.boolean().optional(),
    softDelete: z.boolean().optional(),
    description: z.string().optional(),
    visual_prompt: z.string().optional(),
    assetRef: SemanticAssetRefSchema.optional(),
});

export type OrbitalEntityInput = z.input<typeof OrbitalEntitySchema>;

// ============================================================================
// Type Aliases (for cleaner imports)
// ============================================================================

/** Alias for OrbitalEntity - preferred name */
export type Entity = OrbitalEntity;

/** Alias for OrbitalEntitySchema - preferred name */
export const EntitySchema = OrbitalEntitySchema;

/** The rows an entity starts with for a viewer's locale: its locale block, else `instances`. */
export function instancesForLocale(entity: Pick<OrbitalEntity, 'instances' | 'localeInstances'>, locale: string | undefined): EntityRow[] {
    const localized = locale !== undefined ? entity.localeInstances?.[locale] : undefined;
    return localized ?? entity.instances ?? [];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Derives the collection name for a persistent entity.
 * 
 * Generates the database collection name by converting the entity name
 * to lowercase and adding an 's' suffix (simple pluralization).
 * Returns undefined for non-persistent (runtime) entities.
 * 
 * @param {OrbitalEntity} entity - Entity to derive collection name for
 * @returns {string | undefined} Collection name or undefined for non-persistent entities
 * 
 * @example
 * deriveCollection({ name: 'User', persistence: 'persistent' }); // returns 'users'
 * deriveCollection({ name: 'Task', persistence: 'runtime' }); // returns undefined
 */
export function deriveCollection(entity: OrbitalEntity): string | undefined {
    if (entity.persistence !== 'persistent') {
        return undefined;
    }
    // Lowercase + 's' suffix (simple pluralization)
    return entity.name.toLowerCase() + 's';
}

/**
 * Checks if an entity is runtime-only (not persisted).
 * 
 * Type guard to determine if an entity exists only at runtime
 * and is not stored in the database.
 * 
 * @param {OrbitalEntity} entity - Entity to check
 * @returns {boolean} True if entity is runtime-only, false otherwise
 * 
 * @example
 * isRuntimeEntity({ persistence: 'runtime' }); // returns true
 * isRuntimeEntity({ persistence: 'persistent' }); // returns false
 */
export function isRuntimeEntity(entity: OrbitalEntity): boolean {
    return entity.persistence === 'runtime';
}

/**
 * Whether an entity's rows live in the client: `[runtime]` (in memory) or
 * `[persistent: x, browser]` (the browser's IndexedDB). Data effects on such an
 * entity run in the client. Twin of Rust `EntityDefinition::is_client_resident`.
 */
export function isClientResident(entity: Pick<OrbitalEntity, 'persistence' | 'browser'>): boolean {
    return entity.persistence === 'runtime' || entity.browser === true;
}

/**
 * Whether an entity's ROWS live in the browser (`[persistent: x, browser]`), so
 * `fetch`/`persist` on it run client-side. A `[runtime]` entity's rows stay in
 * the server's per-session store. Twin of Rust `Residence` (`effects/runs_on.rs`).
 */
export function storesRowsInBrowser(entity: Pick<OrbitalEntity, 'browser'>): boolean {
    return entity.browser === true;
}

/**
 * Checks whether an entity's persistence mode allows `persistence` /
 * `collection` overrides at the factory call site.
 *
 * Only `persistent` entities (explicit or default) support these overrides.
 * Runtime entities are fixed; callers must not expose `persistence` or
 * `collection` params for them.
 *
 * @param persistence - The entity persistence mode (undefined = default persistent)
 * @returns True when overrides are allowed, false otherwise
 *
 * @example
 * persistenceModeAllowsOverrides('persistent'); // returns true
 * persistenceModeAllowsOverrides('runtime');    // returns false
 * persistenceModeAllowsOverrides(undefined);    // returns true (default persistent)
 */
export function persistenceModeAllowsOverrides(
    persistence: EntityPersistence | undefined,
    dataBearing = false,
): boolean {
    // A runtime record a data atom fetches or persists may be saved; other runtime state may not.
    return persistence === 'persistent' || persistence === undefined || (persistence === 'runtime' && dataBearing);
}

// ============================================================================
// Entity Instance Data (Runtime)
// ============================================================================

/**
 * A single field value at runtime.
 * Union of all possible types from FieldType: string, number, boolean, date, array, nested.
 * The nested-record branch's index signature tolerates `undefined` so that
 * TypeScript optional properties (`x?: string`, carrying `string | undefined`)
 * on EntityRow extenders typecheck without ceremony. At JSON serialization
 * time `undefined` is equivalent to "key absent" and never appears on the
 * wire; the inclusion here is a pure type-surface accommodation.
 */
export type FieldValue = string | number | boolean | Date | null | string[] | FieldValue[] | { [key: string]: FieldValue | undefined };

/** Zod twin of `FieldValue` — the one runtime validator for a stored field slot. */
export const FieldValueSchema: z.ZodType<FieldValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.date(), z.null(), z.array(FieldValueSchema), z.record(z.string(), FieldValueSchema.optional())]),
);

/**
 * What a FORM CONTROL puts on the event bus — the closed set of shapes an
 * Input / Select / Checkbox / Date / multi-select / file field actually
 * produces.
 *
 * A TRANSPORT type, deliberately distinct from `FieldValue`, and the separation
 * is the point. `FieldValue` conflated two jobs: what a control emits, and what
 * an entity field holds. The second never needed it — an entity field always
 * has one declared type (`email : email!`, `age : number`) — so the openness
 * only travelled outward, degrading every generated `.lolo` payload to a
 * shapeless `object`.
 *
 * NOT recursive, and the variants are enumerated from what is actually emitted
 * rather than guessed. `FileValue` is here because the compiler put it here: a
 * scalar-only draft failed against the file field, which hands
 * `Form.handleChange` a `{ name, url, mimeType, sizeBytes }` record.
 *
 * The rule is Aeson's — enumerate the shapes that occur, keep the open type at
 * the boundary, convert on the way in. In `.lolo` that boundary is the
 * `(set @entity.X ?value)` of the receiving transition, where the entity
 * field's own declared type does the checking.
 */
export type ControlValue = string | number | boolean | null | string[] | FileValue;

/**
 * Runtime guard for `FieldValue` — narrows interpreter-produced `unknown`
 * values at typed substrate boundaries (e.g. sampled values).
 */
export function isFieldValue(value: RuntimeValue): value is FieldValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return true;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.every((item: RuntimeValue) => isFieldValue(item));
  if (kind === 'object' && value !== null && typeof value === 'object') {
    return Object.values(value).every((item: RuntimeValue) => item === undefined || isFieldValue(item));
  }
  return false;
}

/**
 * One instance of an entity with actual field values.
 * The shape is determined by the Entity definition at schema time.
 *
 * @example
 * // Entity defines: Patient { fullName: string, age: number, active: boolean }
 * // EntityRow is: { id: "p1", fullName: "Sarah", age: 34, active: true }
 */
export type EntityRow = { id?: string } & Record<string, FieldValue | undefined>;

/** Zod twin of `EntityRow` — the one runtime validator for an `@entity` wire row. */
export const EntityRowSchema: z.ZodType<EntityRow> = z
  .object({ id: z.string().optional() })
  .catchall(FieldValueSchema.optional());

/**
 * A field-TYPED `EntityRow` — the SINGLE entity type, refined with a concrete
 * field SHAPE `S`. Non-optional members of `S` are REQUIRED, each with its real
 * type; the result stays `& EntityRow`, so the index signature is intact and
 * every other field is still field-open — any domain entity that provides those
 * fields satisfies it.
 *
 * One declaration, two jobs: (1) TypeScript enforces the bound entity has the
 * fields WITH their types (a behavior binding a thinner/mistyped entity fails to
 * typecheck); and (2) pattern-sync reads the same type and writes the entity
 * prop's field shape (`properties` + `requiredFields`) onto the registry, so
 * lolo-ui emits a COMPLETE `entity { … }` (every field, typed + demo-seeded) and
 * the `ORB_X_ENTITY_PROP_CONTRACT` validator rejects an incompatible bind at
 * `orbital validate`. (A raw `EntityRow & { rating: number }` intersection is
 * equivalent for one-off shapes.)
 *
 * @example
 * // HeroOrganism renders entity.title / entity.subtitle:
 * entity?: EntityWith<{ title: string; subtitle?: string }>;
 * //   entity.title    → string                  (required)
 * //   entity.subtitle → string | undefined      (optional)
 * //   entity.other    → FieldValue | undefined  (still field-open)
 */
// `S extends object` (not `Record<string, FieldValue>`) so a plain `interface`
// row shape satisfies it — interfaces lack the implicit index signature `Record`
// requires. FieldValue-compatibility is still enforced structurally: `& EntityRow`
// intersects every field with the `FieldValue | undefined` index signature, so a
// non-FieldValue field (e.g. a React `LucideIcon`) collapses to `never` at use.
export type EntityWith<S extends object> = EntityRow & S;

/**
 * Collection of entity instances keyed by entity name.
 * Used by OrbPreview mockData, OrbitalServerRuntime state, data grids, etc.
 *
 * @example
 * const data: EntityData = {
 *   Patient: [{ id: "1", fullName: "Sarah", age: 34 }],
 *   QueueEntry: [{ id: "1", patientName: "Sarah", waitMinutes: 12 }],
 * };
 */
export type EntityData = Record<string, EntityRow[]>;
