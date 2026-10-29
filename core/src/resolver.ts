/**
 * Schema Resolver
 *
 * Converts OrbitalSchema to Intermediate Representation (IR).
 * Resolves all entity references, expands traits, and prepares schema for compilation/runtime.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from './types/schema.js';
import type { Orbital, Trait, Page, PageTraitRef, Entity } from './types/index.js';
import type { ResolvedIR, ResolvedPage, ResolvedEntity, ResolvedTrait, ResolvedTraitEvent, ResolvedTraitTransition, ResolvedTraitTick } from './types/ir.js';
import type { EntityField } from './types/field.js';
import type { FieldValue } from './types/entity.js';
import type { State, Event, Transition } from './types/state-machine.js';
import type { TraitEventListener, TraitTick } from './types/trait.js';
import { isRoutePage } from './types/page.js';

/**
 * Extended entity shape for schema data that may carry `defaults`/`icon`.
 * The core Entity type does not include either — `defaults` is extra data
 * for singleton initialization, `icon` an optional display extension —
 * but parsed schemas can attach both.
 */
interface EntityWithDefaults extends Entity {
  defaults?: Record<string, FieldValue>;
  icon?: string;
}

// ============================================================================
// Cache
// ============================================================================

/**
 * Cache for resolved schemas, keyed on the schema object reference.
 *
 * Identity-based caching (WeakMap) is the only correct shape here: two
 * versions of the same logical schema with the same `name` + `version`
 * can have different content (e.g. a palette drop adds a render-ui
 * pattern, an agent edit rewrites a trait's effects). The old
 * `${name}-${version}` key collided across content mutations and
 * returned a stale IR — fine for the compiler's one-shot path, fatal
 * for the runtime's live-editing path where downstream identity checks
 * (`traits` array refs, trait state-machine references) depend on the
 * IR being fresh when the schema's content moved.
 *
 * WeakMap also means we don't have to think about cache invalidation:
 * when the consumer drops its reference to the schema, the entry is
 * garbage-collected automatically.
 */
let schemaCache = new WeakMap<OrbitalSchema, ResolvedIR>();

/**
 * Clear the schema resolution cache.
 *
 * With WeakMap-on-reference caching, cache entries die naturally when
 * the schema object is GC'd, so explicit clearing is rarely necessary.
 * Kept for hot-reload paths that want to force fresh resolution; since
 * WeakMap has no `clear()`, we swap in a fresh instance.
 */
export function clearSchemaCache(): void {
  schemaCache = new WeakMap<OrbitalSchema, ResolvedIR>();
}

/**
 * Get cache statistics (for debugging).
 *
 * WeakMap doesn't expose size or keys; the best we can do is signal
 * that the cache is identity-keyed. Kept for API parity with the old
 * Map-based cache.
 */
export function getSchemaCacheStats(): { size: number; keys: string[] } {
  return { size: -1, keys: [] };
}

// ============================================================================
// Schema to IR Conversion
// ============================================================================

/**
 * Convert OrbitalSchema to Intermediate Representation (IR).
 *
 * This function:
 * 1. Resolves all entity references
 * 2. Expands trait definitions (inline or from library)
 * 3. Resolves page bindings
 * 4. Creates the IR structure used by compiler and runtime
 *
 * @param schema - OrbitalSchema to convert
 * @param useCache - Whether to use cached result (default: true)
 * @returns Fully resolved IR
 *
 * @example
 * const schema = { name: 'MyApp', orbitals: [...] };
 * const ir = schemaToIR(schema);
 * console.log(ir.entities.size); // Number of entities
 * console.log(ir.pages.size); // Number of pages
 */
export function schemaToIR(schema: OrbitalSchema, useCache: boolean = true): ResolvedIR {
  // Identity cache: same object reference → same IR. Caller is responsible
  // for handing us a fresh ref when content moved (e.g. immutable update).
  if (useCache) {
    const cached = schemaCache.get(schema);
    if (cached) return cached;
  }

  // Create empty IR structure
  const ir: ResolvedIR = {
    appName: schema.name,
    description: schema.description,
    version: schema.version || '1.0.0',
    entities: new Map<string, ResolvedEntity>(),
    traits: new Map<string, ResolvedTrait>(),
    pages: new Map<string, ResolvedPage>(),
    entityBindings: [],
    generatedAt: new Date().toISOString(),
  };

  // Process each orbital
  for (const orbital of schema.orbitals as Orbital[]) {
    // Resolve entity if present
    if (orbital.entity && typeof orbital.entity !== 'string') {
      const entityDef = orbital.entity as EntityWithDefaults;
      const entity: ResolvedEntity = {
        name: entityDef.name,
        description: entityDef.description,
        icon: entityDef.icon,
        ...(entityDef.collection ? { collection: entityDef.collection } : {}),
        fields: (entityDef.fields || [])
          .filter((field: EntityField): field is EntityField & { name: string } =>
            typeof field.name === 'string' && field.name.length > 0,
          )
          .map((field) => ({
          name: field.name,
          type: field.type,
          tsType: inferTsType(field.type),
          description: field.description,
          default: field.default,
          required: field.required ?? false,
          // lolo string unions lower to `type:'string'` + a `values` sidecar
          // (FieldType::Enum is never emitted) — read values off any variant
          // that carries them, not just `enum`. EXCLUDES `type:'union'`
          // deliberately: its `values` carries tagged-union variant NAMES or a
          // by-name recursive back-reference (`type MenuItem = { subMenu :
          // [MenuItem] }`), never legal literal values — treating either as
          // an enum vocabulary would let a downstream option-list render the
          // variant/alias NAME as if it were a selectable value (mirrors the
          // Rust-side skip in `orbital-core/src/type_compat.rs`).
          values: field.type !== 'union' && 'values' in field && field.values?.length ? field.values : undefined,
          enumValues: field.type !== 'union' && 'values' in field && field.values?.length ? field.values : undefined,
          relation: field.type === 'relation' ? field.relation : undefined,
          intrinsic: field.intrinsic,
          items: 'items' in field ? field.items : undefined,
          properties: field.properties,
        })),
        runtime: entityDef.persistence === 'runtime',
        shared: entityDef.shared,
        hasInstances: (entityDef.instances?.length ?? 0) > 0,
        instances: entityDef.instances,
        defaults: entityDef.defaults,
        usedByTraits: [],
        usedByPages: [],
      };
      ir.entities.set(entity.name, entity);
    }

    // Resolve traits. Preprocessed ref traits from @almadar/runtime's
    // preprocessSchema arrive as wrappers { ref, config, linkedEntity,
    // _resolved: <full trait> }. Unwrap those before projecting so the
    // page-level trait binding can find them by name in ir.traits.
    // Without this unwrap, `trait.name` on a ref wrapper is undefined,
    // and useTraitStateMachine subscribes to zero events for every ref.
    for (const rawTrait of (orbital.traits || [])) {
      const maybeResolved =
        typeof rawTrait === 'object' && 'ref' in rawTrait ? rawTrait._resolved : undefined;
      const trait: Trait =
        maybeResolved && maybeResolved.stateMachine
          ? maybeResolved
          : (rawTrait as Trait);
      if (!trait.name) continue;
      const resolvedTrait: ResolvedTrait = {
        name: trait.name,
        description: trait.description,
        source: 'schema',
        // V4 dual-carry ids + emit contracts, preserved when the source
        // trait carries them — the emit-source stamp needs `id`/`eventId`
        // for id-scoped `listens` matching (`buildSourceMatcher` compares
        // ids ONLY, so a name-only stamp never matches a `traitId`-carrying
        // listen). Absent on id-free schemas, which keep the legacy
        // name-only stamp exactly as before.
        ...(trait.id !== undefined ? { id: trait.id } : {}),
        ...(trait.emits !== undefined
          ? { emits: trait.emits.map((e) => ({ event: e.event, eventId: e.eventId })) }
          : {}),
        states: (trait.stateMachine?.states || []).map((s: State) => ({
          name: s.name,
          isInitial: s.isInitial ?? false,
          isFinal: s.isFinal ?? s.isTerminal ?? false,
        })),
        events: (trait.stateMachine?.events || []).map((e: Event) => ({
          key: e.key,
          name: e.name,
          payload: e.payloadSchema,
        })) as ResolvedTraitEvent[],
        transitions: (trait.stateMachine?.transitions || []).map((t: Transition) => ({
          from: t.from,
          to: t.to,
          event: t.event,
          guard: t.guard,
          effects: t.effects || [],
        })) as ResolvedTraitTransition[],
        guards: [],
        ticks: (trait.ticks || []).map((tk: TraitTick) => ({
          name: tk.name,
          interval: tk.interval,
          guard: tk.guard,
          effects: tk.effects,
          priority: tk.priority ?? 0,
          appliesTo: tk.appliesTo ?? [],
          whileVisible: tk.whileVisible === true,
        })) as ResolvedTraitTick[],
        listens: (trait.listens || []).map((l: TraitEventListener) => ({
          event: l.event,
          triggers: l.triggers,
          guard: l.guard,
          payloadMapping: l.payloadMapping,
          source: l.source,
        })),
        dataEntities: [],
        linkedEntity: trait.linkedEntity,
        config: trait.config,
      };
      ir.traits.set(trait.name, resolvedTrait);
    }

    // Resolve pages: the route table a client opens; protocol pages are served by other sides
    for (const page of (orbital.pages || []) as Page[]) {
      if (!isRoutePage(page)) continue;
      const resolvedPage: ResolvedPage = {
        name: page.name,
        path: page.path,
        featureName: page.name.toLowerCase(),
        viewType: page.viewType && ['list', 'detail', 'create', 'edit', 'dashboard'].includes(page.viewType) ?
          page.viewType as ('list' | 'detail' | 'create' | 'edit' | 'dashboard') : undefined,
        ...pageModifiers(page),
        sections: [],
        traits: (page.traits || []).map((traitRef: PageTraitRef) => {
          const resolvedTrait = resolveTraitRef(traitRef, ir.traits, orbital.traits as Trait[] || []);
          // Precedence: page-level rebind → orbital-trait-wrapper rebind →
          // atom's resolved trait linkedEntity (from `uses` import) →
          // orbital primary entity. Without walking past the wrapper to
          // the atom's _resolved, atoms imported via `uses` without an
          // explicit `-> Entity` rebind silently rebind to the orbital's
          // primary entity (gap #22 design said atoms keep their own
          // auxiliary entity).
          const orbitalTrait = (orbital.traits as Trait[] || []).find(
            (t): t is Trait => typeof t === 'object' && t !== null
              && (
                ('name' in t && (t as { name?: string }).name === traitRef.ref)
                || ('ref' in t && (t as { ref?: string }).ref === traitRef.ref)
              )
          );
          const orbitalTraitWrapped = orbitalTrait as (Trait & { _resolved?: Trait }) | undefined;
          const wrapperLinked = orbitalTraitWrapped?.linkedEntity ?? orbitalTraitWrapped?._resolved?.linkedEntity;
          const resolvedLinked = resolvedTrait?.linkedEntity;
          return {
            ref: traitRef.ref,
            trait: resolvedTrait,
            linkedEntity: traitRef.linkedEntity ?? wrapperLinked ?? resolvedLinked ??
              (orbital.entity ? (typeof orbital.entity === 'string' ? orbital.entity.replace('.entity', '') : (orbital.entity as Entity).name) : undefined),
            config: traitRef.config,
          };
        }),
        entityBindings: [],
        navigation: [],
        singletonEntities: [],
      };
      ir.pages.set(page.name, resolvedPage);
    }
  }

  // Cache result against the schema's object identity.
  if (useCache) {
    schemaCache.set(schema, ir);
  }

  return ir;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Infers TypeScript type from schema type string
 * 
 * Converts schema type strings to their TypeScript equivalents.
 * Handles primitive types, arrays, and custom types.
 * 
 * @param {string} schemaType - Schema type string (e.g., 'string', 'number[]')
 * @returns {string} TypeScript type string
 * 
 * @example
 * inferTsType('string') // returns 'string'
 * inferTsType('number[]') // returns 'number[]'
 * inferTsType('custom') // returns 'custom'
 */
function inferTsType(schemaType: string): string {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'Date',
    datetime: 'Date',
    timestamp: 'number',
    money: 'number',
    file: 'FileValue',
    bytes: 'string',
    array: 'unknown[]',
    object: 'Record<string, unknown>',
    any: 'unknown',
  };

  // Handle array types like "string[]"
  if (schemaType.endsWith('[]')) {
    const baseType = schemaType.slice(0, -2);
    return `${typeMap[baseType] || baseType}[]`;
  }

  // Typed-map form `Map<K,V>` (the orbital `Map K V` type) → `Record<K, V>`.
  // Mirrors the Rust `parse_payload_field_type` map branch.
  if (schemaType.startsWith('Map<') && schemaType.endsWith('>')) {
    const inner = schemaType.slice(4, -1);
    const comma = inner.indexOf(',');
    if (comma !== -1) {
      const key = inferTsType(inner.slice(0, comma).trim());
      const value = inferTsType(inner.slice(comma + 1).trim());
      return `Record<${key}, ${value}>`;
    }
  }

  return typeMap[schemaType] || schemaType;
}

/**
 * Resolves a trait reference to a full trait definition
 * 
 * Looks up trait references in the resolved traits map or schema traits array.
 * Creates appropriate trait structures for different reference types.
 * 
 * @param {PageTraitRef} traitRef - Trait reference (string or object)
 * @param {Map<string, ResolvedTrait>} traitsMap - Map of resolved traits
 * @param {Trait[]} schemaTraits - Array of schema traits
 * @returns {ResolvedTrait} Resolved trait definition
 * 
 * @example
 * const trait = resolveTraitRef('MyTrait', traitsMap, schemaTraits);
 * const trait = resolveTraitRef({ ref: 'MyTrait' }, traitsMap, schemaTraits);
 */
function resolveTraitRef(
  traitRef: PageTraitRef,
  traitsMap: Map<string, ResolvedTrait>,
  schemaTraits: Trait[]
): ResolvedTrait {
  const refName = typeof traitRef === 'string' ? traitRef : traitRef.ref || '';

  // Try to find in resolved traits
  if (traitsMap.has(refName)) {
    return traitsMap.get(refName)!;
  }

  // Try to find in schema traits
  const schemaTrait = schemaTraits.find((t: Trait) => t.name === refName);
  if (schemaTrait) {
    // This is a simplified inline trait
    return {
      name: refName,
      source: 'inline',
      states: [],
      events: [],
      transitions: [],
      guards: [],
      ticks: [],
      listens: [],
      dataEntities: [],
    };
  }

  // Fallback: create empty trait
  return {
    name: refName,
    source: 'schema',
    states: [],
    events: [],
    transitions: [],
    guards: [],
    ticks: [],
    listens: [],
    dataEntities: [],
  };
}

// ============================================================================
// Page Helpers
// ============================================================================

/**
 * Get a specific page from resolved IR by name.
 * If no name is provided, returns the page marked `[initial]`, else the first page.
 *
 * @param ir - Resolved IR
 * @param pageName - Optional page name to find
 * @returns Resolved page or undefined
 *
 * @example
 * const ir = schemaToIR(schema);
 * const homePage = getPage(ir, 'HomePage');
 * const initialPage = getPage(ir); // No name = the initial page
 */
export function getPage(ir: ResolvedIR, pageName?: string): ResolvedPage | undefined {
  if (!pageName) {
    const pages = Array.from(ir.pages.values());
    return pages.find((page) => page.isInitial === true) ?? pages[0];
  }
  return ir.pages.get(pageName);
}

/**
 * Get all pages from resolved IR as an array
 *
 * @param ir - Resolved IR
 * @returns Array of resolved pages
 */
export function getPages(ir: ResolvedIR): ResolvedPage[] {
  return Array.from(ir.pages.values());
}

/**
 * Get a specific entity from resolved IR by name
 *
 * @param ir - Resolved IR
 * @param entityName - Entity name to find
 * @returns Resolved entity or undefined
 */
export function getEntity(ir: ResolvedIR, entityName: string): ResolvedEntity | undefined {
  return ir.entities.get(entityName);
}

/**
 * Get a specific trait from resolved IR by name
 *
 * @param ir - Resolved IR
 * @param traitName - Trait name to find
 * @returns Resolved trait or undefined
 */
export function getTrait(ir: ResolvedIR, traitName: string): ResolvedTrait | undefined {
  return ir.traits.get(traitName);
}

/** The declared page modifiers, omitting absent ones (never defaulted). */
export function pageModifiers(
  page: Pick<Page, 'access' | 'indexing' | 'title' | 'description' | 'sourcePage' | 'translationOf' | 'isInitial' | 'isNotFound'>,
): Pick<ResolvedPage, 'access' | 'indexing' | 'title' | 'description' | 'sourcePage' | 'translationOf' | 'isInitial' | 'isNotFound'> {
  return {
    ...(page.isInitial === true ? { isInitial: true } : {}),
    ...(page.isNotFound === true ? { isNotFound: true } : {}),
    ...(page.access !== undefined ? { access: page.access } : {}),
    ...(page.indexing !== undefined ? { indexing: page.indexing } : {}),
    ...(page.sourcePage !== undefined ? { sourcePage: page.sourcePage } : {}),
    ...(page.translationOf !== undefined ? { translationOf: page.translationOf } : {}),
    ...(page.title !== undefined ? { title: page.title } : {}),
    ...(page.description !== undefined ? { description: page.description } : {}),
  };
}
