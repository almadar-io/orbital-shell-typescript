/**
 * Orbital Builders
 *
 * Pure functions for constructing and composing Orbitals.
 * No new types. Everything uses existing core types:
 * Entity, Trait, Page, OrbitalDefinition, OrbitalSchema.
 *
 * Three categories:
 * 1. Builders: construct Entity, Page from common params
 * 2. Utilities: ensureIdField, resolveDefaults
 * 3. Composition: connect, compose, pipe
 *
 * @packageDocumentation
 */

import type { Entity, EntityPersistence, EntityRow } from './types/entity.js';
import type { EntityField } from './types/field.js';
import type { Page } from './types/page.js';
import type { EntityRef, ExpectDeclaration, OrbitalDefinition, OrbitalRefTraitOverride, PageRef, PageRefObject, UseDeclaration } from './types/orbital.js';
import { isEntityCall, isEntityReference, parseEntityRef } from './types/orbital.js';
import type { OrbitalSchema } from './types/schema.js';
import type { TraitEventContract, TraitEventListener, Trait, TraitRef, TraitReference, TraitConfig, CallSiteConfig, DeclaredTraitConfig } from './types/trait.js';
import type { SExpr } from './types/expression.js';
import type { RuntimeValue } from './types/json.js';
import { isOrbitalValue, OrbitalValueSchema, type OrbitalValue } from './types/behavior-value.js';
import { mergeCallSiteConfigOverrides } from './types/trait.js';
import { parseOrbitalSchema } from './types/schema.js';
import type { EntityId } from './types/identity.js';

// Re-export compose-behaviors module
export { applyTraitConfigOverrides } from './builders/apply-config-overrides.js';
export { type LayoutStrategy, detectLayoutStrategy } from './builders/layout-strategy.js';
export { type EventWiringEntry, applyEventWiring } from './builders/event-wiring.js';
export {
  type ComposeBehaviorsInput,
  type ComposeBehaviorsResult,
  composeBehaviors,
  mergeLedgers,
} from './builders/compose-behaviors.js';
export {
  type ComposeAppFromFilesOptions,
  type ComposeAppFromFilesResult,
  type ComposedSurface,
  type ComposeSurfaceOptions,
  type ConfigNavItemsNarrowResult,
  type IdentityDedupeResult,
  type IdentityDemotion,
  type IdentityExpectsRewrite,
  type IdentityRelationRetarget,
  type IdentityRoleUnion,
  type LandingNavResult,
  type OrganismRename,
  type UnrenamableCollision,
  type NavItemsNarrowResult,
  type SurfaceRename,
  asEntityObject,
  composeAppFromFiles,
  composeOrbitalSurface,
  dedupeComposedIdentity,
  dedupeComposedSurface,
  identityVocabularyDelta,
  type IdentityVocabularyDelta,
  orbitalEntityName,
  orbitalImportResolver,
  organismOrderResolver,
} from './builders/compose-app.js';
export { type EntityRenameBlocker, type RenameEntityOptions, atomTraitResolver, entityRenameBlockers, renameEntity, renameEntityInSchema, renameOrbital } from './builders/rename-entity.js';
export { orbitalRouteSlug } from './builders/route-slug.js';
export { collectOwnedSurface, findDanglingRefs } from './builders/owned-surface.js';
export {
  type FieldBindingContext,
  collectFieldComparisonLiterals,
  collectOwnerComparedFields,
  collectOwnerStampedFields,
} from './builders/field-comparison-literals.js';
// LayoutTrait + slot-embedding helpers (Phase 7.6 — atom-composition recipe path).
export {
  type MakeLayoutTraitOpts,
  makeSlot,
  makeRenderUI,
  makeLayoutTrait,
} from './builders/layout-trait.js';

// ============================================================================
// Utilities
// ============================================================================

/**
 * Ensure the fields array has an `id` field. Prepends one if missing.
 */
export function ensureIdField(fields?: EntityField[]): EntityField[] {
  if (!fields || fields.length === 0) return [{ name: 'id', type: 'string', required: true }];
  if (fields.some(f => f.name === 'id')) return fields;
  return [{ name: 'id', type: 'string', required: true }, ...fields];
}

/**
 * Simple pluralization: append 's'.
 */
export function plural(name: string): string {
  return name + 's';
}

/**
 * Resolve a printable entity name from any EntityRef shape.
 *
 * Handles:
 * - inline Entity object (uses `name`)
 * - bare string reference like "Modal.entity" (uses the alias)
 * - EntityCall { extends: "Modal.entity", name? } (uses `name` if set, else the alias)
 */
function resolveEntityNameForBuilder(ref: EntityRef): string {
  if (isEntityReference(ref)) {
    return parseEntityRef(ref)?.alias ?? ref;
  }
  if (isEntityCall(ref)) {
    if (ref.name) return ref.name;
    return parseEntityRef(ref.extends)?.alias ?? ref.extends;
  }
  return ref.name;
}

// ============================================================================
// Entity Builder
// ============================================================================

export interface MakeEntityOpts {
  name: string;
  fields: EntityField[];
  persistence?: EntityPersistence;
  collection?: string;
  /** Pre-authored seed data instances */
  instances?: EntityRow[];
}

/**
 * Build an Entity from options. Auto-adds id field, auto-derives collection.
 */
export function makeEntity(opts: MakeEntityOpts): Entity {
  const fields = ensureIdField(opts.fields);
  const persistence = opts.persistence ?? 'runtime';
  return {
    name: opts.name,
    persistence,
    ...(persistence === 'persistent'
      ? { collection: opts.collection ?? plural(opts.name).toLowerCase() }
      : {}),
    fields,
    ...(opts.instances && opts.instances.length > 0 ? { instances: opts.instances } : {}),
  };
}

// ============================================================================
// Page Builder
// ============================================================================

export interface MakePageOpts {
  name: string;
  path: string;
  traitName: string;
  isInitial?: boolean;
}

/**
 * Build a Page that binds to a single trait.
 */
export function makePage(opts: MakePageOpts): Page {
  return {
    name: opts.name,
    path: opts.path,
    ...(opts.isInitial ? { isInitial: true } : {}),
    traits: [{ ref: opts.traitName }],
  };
}

// ============================================================================
// Orbital Builder
// ============================================================================

/**
 * Build an OrbitalDefinition from its three components.
 */
export function makeOrbital(
  name: string,
  entity: Entity,
  traits: Trait[],
  pages: Page[],
): OrbitalDefinition {
  return { name, entity, traits, pages } as OrbitalDefinition;
}

// ============================================================================
// Reference-form Builders (Phase 4.2)
// ============================================================================
//
// The atom/molecule/organism composition model (see CLAUDE.md "Std Behaviors")
// treats every imported orbital as a callable unit: a reference site is a call
// site whose sibling fields are call arguments. The compiler's inline pass
// applies overrides from the reference to a cloned copy of the imported unit.
//
// These four helpers are convenience factories for constructing the reference
// payloads (TraitReference, PageRefObject) and the orbital skeleton that
// holds them. They exist to compress the otherwise ~200-line-per-behavior TS
// rewrite down to ~30 lines. They purely pass-through fields: undefined
// optionals are omitted (the emitted object never contains `key: undefined`),
// so the result stays compatible with the inliner's "present-means-override"
// semantics.

/**
 * Options for {@link makeTraitRef}.
 */
export interface MakeTraitRefOpts {
  /**
   * Optional registry path disambiguator that pairs with {@link ref}
   * (see {@link TraitReference.from}).
   */
  from?: string;
  /** Trait reference string, e.g. "Browse.traits.BrowseItemBrowse". */
  ref: string;
  /** Rename the inlined trait at the call site. */
  name?: string;
  /** Rebind the trait to a different linkedEntity. */
  linkedEntity?: string;
  /** Dual-carry id sibling of {@link linkedEntity} (V4 identity graph). */
  linkedEntityId?: EntityId;
  /** Per-key rename map, e.g. `{ OPEN: "ADD_ITEM" }`. */
  events?: Record<string, string>;
  /**
   * 3-II trait type-parameter arguments (`:: p SomeType`): declared-param
   * name → type-vocabulary name. Mirrors {@link TraitReference.typeArgs}.
   */
  typeArgs?: Record<string, string>;
  /**
   * Entity-field remap, e.g. `{ name: "title", folder: "parentId" }`. Rewrites
   * the inlined trait's canonical `@entity.X` / `@payload.row.X` references to
   * the consumer entity's field names. Mirrors {@link TraitReference.fields}.
   */
  fields?: Record<string, string>;
  /**
   * Per-event SExpression effect replacement. Keys are POST-rename event
   * names. See {@link TraitReference.effects} for the full contract.
   */
  effects?: Record<string, SExpr[]>;
  /** Replace the imported trait's `listens` array entirely. */
  listens?: TraitEventListener[];
  /** Set every emit's scope. */
  emitsScope?: 'internal' | 'external';
  /**
   * Call-site config overrides. Each entry is either a plain wiring value
   * (`TraitConfigValue`) or a fully-annotated re-declaration
   * (`ConfigFieldDeclaration`). Matches {@link TraitReference.config}.
   */
  config?: CallSiteConfig;
}

/**
 * Typed-narrowing variant of {@link MakeTraitRefOpts} for callers that know
 * the imported atom's overridable surfaces — its event-key set, listen-key
 * set, and config shape. Generated std factories use this variant so an LLM
 * tool consumer (orbital-agent) sees the closed event-name set and the
 * config field schema instead of the un-narrowed `Record<string, string>` /
 * `TraitConfig` defaults.
 *
 * Type parameters:
 * - `EventKey`   — string union of the atom's emit event names. Narrows the
 *   `events` rename map's keys to legal originals only.
 * - `ConfigShape` — typed shape of the trait's `config { ... }` block (literal
 *   unions intact). Narrows the `config` override to the atom's actual fields.
 *   Extends `CallSiteConfig` to allow both plain wiring values and annotated
 *   declarations. Existing callers using plain `TraitConfig` shapes are
 *   unaffected (TraitConfig ⊆ CallSiteConfig).
 * - `ListenKey`  — string union of the atom's listen-key contract. Narrows
 *   each listens entry's `event` against the atom's real subscription set.
 *
 * Runtime behavior is unchanged — {@link makeTraitRef} accepts both the
 * narrow and wide forms via the standard structural-typing rules. This is
 * a type-level narrowing only; widening at the call boundary is intentional.
 */
export interface MakeTraitRefOptsTyped<
  EventKey extends string = string,
  ConfigShape extends CallSiteConfig = Record<string, never>,
  ListenKey extends string = string,
> extends Omit<
    MakeTraitRefOpts,
    'events' | 'effects' | 'listens' | 'config'
  > {
  /** Per-key rename map, narrowed to the atom's actual event keys. */
  events?: Partial<Record<EventKey, string>>;
  /**
   * Per-event SExpression effect replacement. Keys are POST-rename event
   * names so they're caller-defined (no narrowing here); values stay typed
   * as `SExpr[]`.
   */
  effects?: Partial<Record<string, SExpr[]>>;
  /**
   * Replace the imported trait's `listens` array entirely. Each entry's
   * `event` field is narrowed to {@link ListenKey} where the atom's
   * subscription set is fixed; otherwise this widens to plain string.
   */
  listens?: Array<TraitEventListener & { event?: ListenKey }>;
  /** Typed call-site config overrides — narrowed to {@link ConfigShape}. */
  config?: ConfigShape;
}

/**
 * Build a {@link TraitReference} from options.
 *
 * Pass-through factory: copies only the fields that are actually provided,
 * so optionals stay absent (no `key: undefined` slots) and the emitted
 * object matches the inliner's expectation that "present = override".
 */
export function makeTraitRef(opts: MakeTraitRefOpts): TraitReference {
  const ref: TraitReference = { ref: opts.ref };
  if (opts.from !== undefined) ref.from = opts.from;
  if (opts.name !== undefined) ref.name = opts.name;
  if (opts.linkedEntity !== undefined) ref.linkedEntity = opts.linkedEntity;
  if (opts.linkedEntityId !== undefined) ref.linkedEntityId = opts.linkedEntityId;
  if (opts.events !== undefined) ref.events = opts.events;
  if (opts.typeArgs !== undefined) ref.typeArgs = opts.typeArgs;
  if (opts.fields !== undefined) ref.fields = opts.fields;
  if (opts.effects !== undefined) ref.effects = opts.effects;
  if (opts.listens !== undefined) ref.listens = opts.listens;
  if (opts.emitsScope !== undefined) ref.emitsScope = opts.emitsScope;
  if (opts.config !== undefined) ref.config = opts.config;
  return ref;
}

/**
 * Options for {@link makePageRef}.
 */
export interface MakePageRefOpts {
  /**
   * Optional registry path disambiguator that pairs with {@link ref}
   * (see {@link PageRefObject.from}).
   */
  from?: string;
  /** Page reference string, e.g. "Browse.pages.BrowseItemPage". */
  ref: string;
  /** URL path override. */
  path?: string;
  /** Rebind the page's primary entity. */
  linkedEntity?: string;
  /** Replace the page's trait list. */
  traits?: TraitRef[];
}

/**
 * Typed-narrowing variant of {@link MakePageRefOpts}. Narrows the `traits`
 * override array's entries to the orbital's known trait-name union — so the
 * agent can't pass a trait name that doesn't exist on the page's owning
 * orbital. Generated std page-helpers use this variant to surface the
 * trait set in the tool schema; un-narrowed call sites stay compatible.
 *
 * Type parameter:
 * - `TraitName` — string union of trait names the page may reference.
 */
export interface MakePageRefOptsTyped<TraitName extends string = string>
  extends Omit<MakePageRefOpts, 'traits'> {
  traits?: Array<{ ref: TraitName } | TraitRef>;
}

/**
 * Build a {@link PageRefObject} from options. Pass-through factory — omits
 * optional keys that are `undefined`.
 */
export function makePageRef(opts: MakePageRefOpts): PageRefObject {
  const ref: PageRefObject = { ref: opts.ref };
  if (opts.from !== undefined) ref.from = opts.from;
  if (opts.path !== undefined) ref.path = opts.path;
  if (opts.linkedEntity !== undefined) ref.linkedEntity = opts.linkedEntity;
  if (opts.traits !== undefined) ref.traits = opts.traits;
  return ref;
}

/**
 * Options for {@link makeOrbitalWithUses}.
 */
export interface MakeOrbitalWithUsesOpts {
  /** Orbital name. */
  name: string;
  /**
   * Per-orbital `uses:` header entries (see CLAUDE.md "uses: lives inside
   * the orbital").
   */
  uses: UseDeclaration[];
  /** Entity (inline or reference form). */
  entity: EntityRef;
  /**
   * Derived `expects` declarations (consumer-side requirements). Threaded
   * verbatim — derivation lives in `orb` (`orb behaviors expects`); builders never
   * compute it. Omitted from the result when not provided.
   */
  expects?: ExpectDeclaration[];
  /**
   * Auxiliary entities (name-resolution side channel for un-rebound atom
   * imports — see {@link OrbitalDefinition.auxiliaryEntities}). Threaded
   * verbatim; omitted from the result when not provided.
   */
  auxiliaryEntities?: EntityRef[];
  /** Trait references. */
  traits: TraitRef[];
  /** Optional page references (omitted entirely when not provided). */
  pages?: PageRef[];
  /** The orbital's own declared config knobs, threaded verbatim; omitted when not provided. */
  config?: DeclaredTraitConfig;
}

/**
 * Build an {@link OrbitalDefinition} with the `uses:` header set. Follows
 * the convention that `uses:` lives on the orbital (not the schema).
 *
 * When `pages` is omitted, the result has no `pages` property (matches the
 * existing {@link OrbitalDefinition.pages} optionality in descriptors that
 * carry trait-only atoms).
 */
export function makeOrbitalWithUses(opts: MakeOrbitalWithUsesOpts): OrbitalDefinition {
  const orbital: OrbitalDefinition = {
    name: opts.name,
    uses: opts.uses,
    ...(opts.expects !== undefined ? { expects: opts.expects } : {}),
    entity: opts.entity,
    ...(opts.auxiliaryEntities !== undefined ? { auxiliaryEntities: opts.auxiliaryEntities } : {}),
    traits: opts.traits,
    pages: opts.pages ?? [],
    ...(opts.config !== undefined ? { config: opts.config } : {}),
  };
  return orbital;
}

/** The alias an orbital value's import binds its source under (one import per orbital, so a fixed name is unambiguous). */
export const ORBITAL_VALUE_IMPORT_ALIAS = 'Source';

/**
 * The import orbital an orbital value stands for (LOLO §8b): the value's
 * behavior imported under {@link ORBITAL_VALUE_IMPORT_ALIAS}, its orbital
 * referenced, and its recorded body as the reference body. Plain config values
 * are wrapped into the IR's declaration form here.
 */
export function orbitalImportFromValue(value: OrbitalValue): OrbitalDefinition {
  const { behavior, orbital, name, app, config, traits, uses, siblings, ...body } = value;
  const ref = `${ORBITAL_VALUE_IMPORT_ALIAS}.orbitals.${orbital}`;
  const clash = (uses ?? []).find((u) => u.as === ORBITAL_VALUE_IMPORT_ALIAS);
  if (clash !== undefined) {
    throw new Error(`orbital value ${orbital}: an import aliased '${ORBITAL_VALUE_IMPORT_ALIAS}' (from ${clash.from}) collides with the value's own source alias`);
  }
  const traitOverrides =
    traits === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(traits).map(([trait, overrides]): [string, OrbitalRefTraitOverride] => {
            const { config: traitConfig, ...rest } = overrides;
            return [trait, { ...rest, ...(traitConfig !== undefined ? { config: mergeCallSiteConfigOverrides({}, traitConfig) } : {}) }];
          }),
        );
  return {
    name: name ?? orbital,
    uses: [{ from: behavior, as: ORBITAL_VALUE_IMPORT_ALIAS, ...(app !== undefined ? { config: mergeCallSiteConfigOverrides({}, app) } : {}) }, ...(uses ?? [])],
    entity: `${ref}.entity`,
    traits: (siblings ?? []).map((sibling) => ({
      name: sibling.name,
      ref: sibling.ref,
      ...(sibling.linkedEntity !== undefined ? { linkedEntity: sibling.linkedEntity } : {}),
      ...(sibling.config !== undefined ? { config: mergeCallSiteConfigOverrides({}, sibling.config) } : {}),
    })),
    pages: [],
    reference: {
      ref,
      ...body,
      ...(config !== undefined ? { config: mergeCallSiteConfigOverrides({}, config) } : {}),
      ...(traitOverrides !== undefined ? { traits: traitOverrides } : {}),
    },
  };
}

/**
 * Parse a program held as data: an orbital value at `orbitals[i]` is the import
 * orbital it stands for ({@link orbitalImportFromValue}); everything else must
 * already be IR.
 */
export function parseProgram(data: RuntimeValue): OrbitalSchema {
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !('orbitals' in data) || !Array.isArray(data.orbitals)) {
    return parseOrbitalSchema(data);
  }
  return parseOrbitalSchema({
    ...data,
    orbitals: data.orbitals.map((entry) => (isOrbitalValue(entry) ? orbitalImportFromValue(OrbitalValueSchema.parse(entry)) : entry)),
  });
}

/**
 * Options for {@link makeAtomOrbital}.
 *
 * Overrides for the single trait reference. Mirrors the {@link MakeTraitRefOpts}
 * subset that is meaningful at the atom-wrapping call site.
 */
export interface MakeAtomOrbitalTraitOverrides {
  name?: string;
  events?: Record<string, string>;
  effects?: Record<string, SExpr[]>;
  listens?: TraitEventListener[];
  emitsScope?: 'internal' | 'external';
  config?: CallSiteConfig;
}

/**
 * Options for {@link makeAtomOrbital}.
 */
export interface MakeAtomOrbitalOpts {
  /** Orbital name, e.g. `${entityName}Orbital`. */
  name: string;
  /** Atom registry path, e.g. `std/behaviors/atoms/std-browse`. */
  atomPath: string;
  /** Import alias (PascalCase), e.g. `Browse`. */
  alias: string;
  /** Entity definition to attach to the orbital. */
  entity: Entity;
  /** Trait reference string, e.g. `Browse.traits.BrowseItemBrowse`. */
  traitRef: string;
  /** Optional trait-level overrides applied at the call site. */
  traitOverrides?: MakeAtomOrbitalTraitOverrides;
  /** Optional page reference string, e.g. `Browse.pages.BrowseItemPage`. */
  pageRef?: string;
  /** Optional page-level overrides applied at the call site. */
  pageOverrides?: { path?: string };
}

/**
 * Build a single-atom {@link OrbitalDefinition}.
 *
 * The common atom shape: one entity + one trait reference + (optionally) one
 * page reference, all under a single `uses:` import. Wraps
 * {@link makeTraitRef}, {@link makePageRef}, and {@link makeOrbitalWithUses}.
 *
 * The trait reference is linkedEntity-bound to `entity.name` by default so
 * that the inliner's entity-substitution pass rewrites every `["ref", X]`
 * and `@X.path` reference inside the atom.
 */
export function makeAtomOrbital(opts: MakeAtomOrbitalOpts): OrbitalDefinition {
  const traitRef = makeTraitRef({
    from: opts.atomPath,
    ref: opts.traitRef,
    linkedEntity: opts.entity.name,
    ...(opts.traitOverrides?.name !== undefined ? { name: opts.traitOverrides.name } : {}),
    ...(opts.traitOverrides?.events !== undefined ? { events: opts.traitOverrides.events } : {}),
    ...(opts.traitOverrides?.effects !== undefined ? { effects: opts.traitOverrides.effects } : {}),
    ...(opts.traitOverrides?.listens !== undefined ? { listens: opts.traitOverrides.listens } : {}),
    ...(opts.traitOverrides?.emitsScope !== undefined
      ? { emitsScope: opts.traitOverrides.emitsScope }
      : {}),
    ...(opts.traitOverrides?.config !== undefined ? { config: opts.traitOverrides.config } : {}),
  });

  const pages: PageRef[] | undefined = opts.pageRef
    ? [
        makePageRef({
          from: opts.atomPath,
          ref: opts.pageRef,
          linkedEntity: opts.entity.name,
          ...(opts.pageOverrides?.path !== undefined ? { path: opts.pageOverrides.path } : {}),
        }),
      ]
    : undefined;

  return makeOrbitalWithUses({
    name: opts.name,
    uses: [{ from: opts.atomPath, as: opts.alias }],
    entity: opts.entity,
    traits: [traitRef],
    ...(pages !== undefined ? { pages } : {}),
  });
}

/**
 * Wrap one or more OrbitalDefinitions into an OrbitalSchema.
 * Every .orb file should be a full OrbitalSchema — this is the builder for that.
 */
export function makeSchema(name: string, ...definitions: OrbitalDefinition[]): OrbitalSchema {
  return { name, version: '1.0.0', orbitals: definitions };
}

/**
 * Unwrap inputs that may be OrbitalSchema or OrbitalDefinition into a flat
 * array of OrbitalDefinitions. Used internally by compose/pipe/connect/extractTrait
 * so they accept both types.
 */
function asDefinitions(inputs: (OrbitalDefinition | OrbitalSchema)[]): OrbitalDefinition[] {
  return inputs.flatMap(input => {
    if ('orbitals' in input && Array.isArray((input as OrbitalSchema).orbitals)) {
      return (input as OrbitalSchema).orbitals as OrbitalDefinition[];
    }
    return [input as OrbitalDefinition];
  });
}

/** Unwrap a single OrbitalSchema | OrbitalDefinition to OrbitalDefinition. */
function asDefinition(input: OrbitalDefinition | OrbitalSchema): OrbitalDefinition {
  if ('orbitals' in input && Array.isArray((input as OrbitalSchema).orbitals)) {
    return (input as OrbitalSchema).orbitals[0] as OrbitalDefinition;
  }
  return input as OrbitalDefinition;
}

// ============================================================================
// Intra-Orbital Composition
// ============================================================================

/**
 * Merge multiple OrbitalDefinitions into one.
 * Collects all traits from all sources into a single orbital with a shared entity.
 * Pure: clones all traits, no mutation.
 */
export function mergeOrbitals(
  name: string,
  entity: Entity,
  sources: OrbitalDefinition[],
  pages: Page[],
): OrbitalDefinition {
  const allTraits = sources.flatMap(s =>
    (s.traits as Trait[]).map(t => structuredClone(t)),
  );
  return { name, entity, traits: allTraits, pages } as OrbitalDefinition;
}

/**
 * Wire an intra-orbital event between two traits.
 * Adds emits to the source trait, listens to the target trait.
 * Pure: returns cloned traits, no mutation.
 */
export function wire(
  source: Trait,
  target: Trait,
  event: TraitEventContract,
  triggers: string,
): [Trait, Trait] {
  const s = structuredClone(source);
  const t = structuredClone(target);

  s.emits = [...(s.emits ?? []), { ...event, scope: event.scope ?? ('internal' as const) }];
  t.listens = [...(t.listens ?? []), {
    event: event.event,
    triggers,
    scope: 'internal' as const,
  }];

  return [s, t];
}

/**
 * Extract the first trait from an OrbitalDefinition or OrbitalSchema.
 * If given an OrbitalSchema, unwraps to the first orbital inside it.
 */
export function extractTrait(input: OrbitalDefinition | OrbitalSchema): Trait {
  const orbital = asDefinition(input);
  return structuredClone((orbital.traits as Trait[])[0]);
}

// ============================================================================
// Composition: connect
// ============================================================================

/**
 * Wire a cross-orbital event between two orbitals.
 * Adds emits to a's first trait, listens to b's first trait.
 * Pure: returns new orbitals, no mutation.
 */
export function connect(
  a: OrbitalDefinition | OrbitalSchema,
  b: OrbitalDefinition | OrbitalSchema,
  event: TraitEventContract,
  triggers?: string,
): [OrbitalDefinition, OrbitalDefinition] {
  const aClone = structuredClone(asDefinition(a));
  const bClone = structuredClone(asDefinition(b));

  // Add emit to first trait of a
  const aTrait = (aClone.traits as Trait[])[0];
  if (aTrait) {
    const emitContract: TraitEventContract = {
      ...event,
      scope: event.scope ?? 'external',
    };
    aTrait.emits = [...(aTrait.emits ?? []), emitContract];
  }

  // Add listen to first trait of b
  const bTrait = (bClone.traits as Trait[])[0];
  if (bTrait) {
    const listener: TraitEventListener = {
      event: event.event,
      triggers: triggers ?? 'INIT',
      scope: 'external',
    };
    bTrait.listens = [...(bTrait.listens ?? []), listener];
  }

  return [aClone, bClone];
}

// ============================================================================
// Composition: compose
// ============================================================================

export interface ComposeConnection {
  from: string;
  to: string;
  event: TraitEventContract;
  triggers?: string;
}

export interface ComposePage {
  name: string;
  path: string;
  traits: string[];
  isInitial?: boolean;
}

/**
 * Compose multiple orbitals into a single OrbitalSchema (application).
 * Applies connections (cross-orbital event wiring) and page assignments.
 */
export function compose(
  orbitals: (OrbitalDefinition | OrbitalSchema)[],
  pages: ComposePage[],
  connections: ComposeConnection[],
  appName?: string,
): OrbitalSchema {
  const cloned = structuredClone(asDefinitions(orbitals));

  // Apply connections
  for (const conn of connections) {
    const emitter = cloned.find(o => {
      const traits = o.traits as Trait[];
      return traits.some(t => t.name === conn.from);
    });
    const listener = cloned.find(o => {
      const traits = o.traits as Trait[];
      return traits.some(t => t.name === conn.to);
    });

    if (emitter && listener) {
      const eTrait = (emitter.traits as Trait[]).find(t => t.name === conn.from);
      const lTrait = (listener.traits as Trait[]).find(t => t.name === conn.to);

      if (eTrait) {
        const emitContract: TraitEventContract = { ...conn.event, scope: conn.event.scope ?? 'external' };
        eTrait.emits = [...(eTrait.emits ?? []), emitContract];
      }
      if (lTrait) {
        const listenContract: TraitEventListener = {
          event: conn.event.event,
          triggers: conn.triggers ?? 'INIT',
          scope: 'external',
        };
        lTrait.listens = [...(lTrait.listens ?? []), listenContract];
      }
    }
  }

  // Assign pages to orbitals
  for (const orbital of cloned) {
    const traitNames = (orbital.traits as Trait[]).map(t => t.name);
    const matchingPages = pages.filter(p =>
      p.traits.some(t => traitNames.includes(t)),
    );
    orbital.pages = matchingPages.map(p => ({
      name: p.name,
      path: p.path,
      ...(p.isInitial ? { isInitial: true } : {}),
      traits: p.traits
        .filter(t => traitNames.includes(t))
        .map(ref => ({ ref })),
    }));
  }

  return {
    name: appName ?? 'Application',
    version: '1.0.0',
    orbitals: cloned,
  };
}

// ============================================================================
// Composition: pipe
// ============================================================================

/**
 * Chain orbitals in sequence with automatic event wiring.
 * Sugar over connect + compose: wires events[0] from orbital[0] to orbital[1], etc.
 */
export function pipe(
  orbitals: (OrbitalDefinition | OrbitalSchema)[],
  events: TraitEventContract[],
  appName?: string,
): OrbitalSchema {
  if (events.length !== orbitals.length - 1) {
    throw new Error(`pipe requires exactly ${orbitals.length - 1} events for ${orbitals.length} orbitals`);
  }

  const cloned = structuredClone(asDefinitions(orbitals));

  // Wire adjacent pairs
  for (let i = 0; i < events.length; i++) {
    const aTrait = (cloned[i].traits as Trait[])[0];
    const bTrait = (cloned[i + 1].traits as Trait[])[0];

    if (aTrait) {
      const emitContract: TraitEventContract = { ...events[i], scope: events[i].scope ?? 'external' };
      aTrait.emits = [...(aTrait.emits ?? []), emitContract];
    }
    if (bTrait) {
      const listener: TraitEventListener = {
        event: events[i].event,
        triggers: 'INIT',
        scope: 'external',
      };
      bTrait.listens = [...(bTrait.listens ?? []), listener];
    }
  }

  // Auto-generate pages: one per orbital, first is initial
  const pages: Page[] = cloned.map((o, i) => {
    const entityName = resolveEntityNameForBuilder(o.entity);
    const traitNames = (o.traits as Trait[]).map(t => t.name);
    return {
      name: `${entityName}Page`,
      path: `/${plural(entityName).toLowerCase()}`,
      ...(i === 0 ? { isInitial: true } : {}),
      traits: traitNames.map(ref => ({ ref })),
    };
  });

  // Assign pages back to orbitals
  for (let i = 0; i < cloned.length; i++) {
    cloned[i].pages = [pages[i]];
  }

  return {
    name: appName ?? 'Application',
    version: '1.0.0',
    orbitals: cloned,
  };
}
