/**
 * Orbital Type (Self-Contained)
 *
 * Defines the Orbital - the atomic building block of applications.
 * Formula: Orbital = Entity × Traits × Pages
 *
 * An Orbital is a module that exports { entity, traits, pages }.
 * Use `uses` to import other Orbitals and access their components via:
 * - Alias.entity
 * - Alias.traits.TraitName
 * - Alias.pages.PageName
 *
 * @packageDocumentation
 */

import { z } from "zod";
import type { OsGrants } from "./os-grants.js";
import { OsGrantsSchema } from "./os-grants.js";
import type { OrbitalId, EntityId, TraitId, PageId } from "./identity.js";
import { OrbitalIdSchema, EntityIdSchema, TraitIdSchema, PageIdSchema } from "./identity.js";
import type { Entity, EntityPersistence } from "./entity.js";
import { EntitySchema, EntityPersistenceSchema } from "./entity.js";
import type { EntityField } from "./field.js";
import { EntityFieldSchema } from "./field.js";
import type { Page, PageAccess, PageIndexing, PageMeta, PageModifiers } from "./page.js";
import { PageSchema, PageAccessSchema, PageIndexingSchema, PageMetaSchema, PageModifiersSchema } from "./page.js";
import type {
  TraitRef,
  CallSiteConfig,
  EventPayloadField,
  EventScope,
  Trait,
  DeclaredTraitConfig,
  TraitEventListener,
  ConfigFieldDeclaration,
} from "./trait.js";
import {
  isInlineTrait,
  mergeCallSiteConfigOverrides,
  TraitRefSchema,
  EventPayloadFieldSchema,
  EventScopeSchema,
  TraitSchema,
  DeclaredTraitConfigSchema,
  TraitEventListenerSchema,
  ConfigFieldDeclarationSchema,
} from "./trait.js";
import type {
  DomainContext,
  DesignPreferences,
  SuggestedGuard,
  ThemeRef,
} from "./domain.js";
import {
  DomainContextSchema,
  DesignPreferencesSchema,
  SuggestedGuardSchema,
  ThemeRefSchema,
} from "./domain.js";
import type { ServiceRef } from "./service.js";
import { ServiceRefSchema } from "./service.js";
import type { Expression, SExpr } from "./expression.js";
import { ExpressionSchema, SExprListSchema, SExprSchema } from "./expression.js";

// ============================================================================
// Use Declaration (Import System)
// ============================================================================

/**
 * UseDeclaration - Import an external Orbital as a namespace.
 *
 * After importing, access components via:
 * - Alias.entity - The entity definition
 * - Alias.traits.TraitName - A specific trait
 * - Alias.pages.PageName - A specific page
 *
 * @example
 * ```json
 * {
 *   "uses": [
 *     { "from": "./health.orb", "as": "Health" },
 *     { "from": "std/behaviors/game-core", "as": "GameCore" }
 *   ]
 * }
 * ```
 */
export type UseDeclaration = {
  /**
   * Import source path:
   * - "std/behaviors/game-core" - Standard library
   * - "./shared/health.orb" - Local .orb file (relative path)
   * - "../common/physics.orb" - Parent directory .orb file
   * - "@game-lib/enemies.orb" - Scoped package (configured base)
   */
  from: string;

  /**
   * Alias for accessing imported components.
   * Used as namespace: Alias.entity, Alias.traits.X, Alias.pages.X
   */
  as: string;

  /** `uses A from "…" { config { … } }` override of the upstream schema's declared `config {}` — keys must exist in `OrbitalSchema.config`. */
  config?: DeclaredTraitConfig;

  /** `uses lazy A from "…"` — the imported behavior is compiled to its own `.orb` and loaded when one of its pages is opened; see {@link LazyPage}. */
  lazy?: boolean;
};

export const UseDeclarationSchema = z.object({
  from: z.string().min(1, "Import source is required"),
  as: z
    .string()
    .min(1, "Alias is required")
    .regex(
      /^[A-Z][a-zA-Z0-9]*$/,
      'Alias must be PascalCase (e.g., "Health", "GameCore")',
    ),
  config: DeclaredTraitConfigSchema.optional(),
  lazy: z.boolean().optional(),
});

/**
 * A page served by a lazily-used behavior. The importer's `.orb` lists the
 * page so routing and prerender know it; the behavior itself lives in the
 * `.orb` at `orbRef` (relative to the importer's `.orb`) and is fetched when
 * the page is opened.
 */
export type LazyPage = {
  path: string;
  orbital: string;
  orbRef: string;
};

export const LazyPageSchema = z.object({
  path: z.string().min(1),
  orbital: z.string().min(1),
  orbRef: z.string().min(1),
});

// ============================================================================
// Expect Declaration (Consumer-Side Requirements)
// ============================================================================

/**
 * ExpectDeclaration - a consumer-side requirement: "some sibling orbital
 * provides this, and here is the minimal typed slice of it I rely on."
 *
 * The dual of a provider: the entity `[identity]` tag declares "I am the
 * roster"; `expects identity` declares "I read the roster". Standalone
 * validation trusts the declaration and uses its shape as the local type
 * environment; composed-program validation link-checks it against the real
 * provider. The shape reuses the canonical `EntityField` so all type
 * compatibility flows through the one compat owner. Compile-time only.
 * See docs/Almadar_LOLO_Expects_Proposal.md.
 */
export type ExpectDeclaration = ExpectDeclarationShape & {
  /** Set when the obligation arrived through a spec import: an unprovided one is an error, not deferred. */
  strict?: boolean;
};

type ExpectDeclarationShape =
  | {
      /** `expects identity Customer { role : "admin" | "member" }` — the `@user` fields this orbital reads, typed. */
      kind: "identity";
      name?: string;
      shape?: EntityField[];
    }
  | {
      /** `expects entity OrderRecord { totalAmount : number }` — a sibling entity this orbital touches. Shape omitted = opaque reference. */
      kind: "entity";
      name: string;
      shape?: EntityField[];
      /** `[persistent]` / `[runtime]`: the storage mode the provider must declare. */
      persistence?: EntityPersistence;
      /** `[shared]` / `[local]`: the provider must carry the same tag. */
      shared?: boolean;
      local?: boolean;
      /** `@read|@create|@update|@delete <expr>`: the provider's policy must be this expression. */
      read_policy?: SExpr;
      create_policy?: SExpr;
      update_policy?: SExpr;
      delete_policy?: SExpr;
      /** `@<op> none "<reason>"`: the provider must declare a waiver for each op named. */
      access_waivers?: Entity["access_waivers"];
      /** `@invariant <expr>` (spec only): every stored row satisfies each, proved by `orb validate`. */
      invariants?: SExpr[];
    }
  | {
      /** `expects event Checkout.ORDER_PLACED` — a sibling trait produces this event (Phase 2). */
      kind: "event";
      traitName: string;
      event: string;
      /** The payload fields the event must carry, checked against the provider's `emits`. */
      payload?: EventPayloadField[];
    }
  | {
      /**
       * `expects page "/articles/:slug"` — a route a sibling orbital declares
       * and this one navigates to. The one cross-boundary edge a `navigate`
       * effect cannot state for itself: the effect carries a static prefix
       * (`/articles/`), the provider a pattern (`/articles/:slug`), and the
       * parameterisation is information the usage does not hold. Derived, not
       * hand-authored — `orb behaviors expects` derives them.
       */
      kind: "page";
      path: string;
      /** `expects page "/p" -> A, B`: the traits the provider page must mount. */
      traits?: string[];
    }
  | {
      /** `expects trait T { state paid }`: the provider trait declares this state. */
      kind: "state";
      traitName: string;
      state: string;
      /** `state paid @holds <expr>` (spec only): holds over `@entity` while the trait is in the state, proved by `orb validate`. */
      holds?: SExpr;
    }
  | {
      /** `expects trait T { state idle { PAY -> paid } }`: the provider trait has this transition. */
      kind: "transition";
      traitName: string;
      from: string;
      event: string;
      to: string;
      /** `@ensures <expr>`: the outcome contract owed at this transition (`@fromEntity` is the row before it). */
      ensures?: SExpr[];
    }
  | {
      /** `expects config { stdio : string = "pipe" }`: a trait declares this knob, of this type and stated default. */
      kind: "config";
      name: string;
      knob: ConfigFieldDeclaration;
    };

/**
 * The entity name an expectation is ABOUT, or undefined when it is not about
 * an entity at all (`event` names a trait's event, `page` a route, and a bare
 * `expects identity` defers to whoever is tagged `[identity]`).
 *
 * TS counterpart of the compiler's `expectations::expected_entity_names` and
 * L1's `types::expected_entity_names`. Exists so callers stop reaching for
 * `kind !== "event"` as a stand-in for "has a name" — a proxy that silently
 * became wrong the moment a second nameless kind was added.
 */
export function expectedEntityName(decl: ExpectDeclaration): string | undefined {
  switch (decl.kind) {
    case "entity":
      return decl.name;
    case "identity":
      return decl.name;
    case "event":
    case "page":
    case "state":
    case "transition":
    case "config":
      return undefined;
  }
}

export const ExpectDeclarationSchema = z.discriminatedUnion("kind", [
  z.object({
    strict: z.boolean().optional(),
    kind: z.literal("identity"),
    name: z.string().optional(),
    shape: z.array(EntityFieldSchema).optional(),
  }),
  z.object({
    strict: z.boolean().optional(),
    kind: z.literal("entity"),
    name: z.string().min(1, "Expected entity name is required"),
    shape: z.array(EntityFieldSchema).optional(),
    persistence: EntityPersistenceSchema.optional(),
    shared: z.boolean().optional(),
    local: z.boolean().optional(),
    read_policy: SExprSchema.optional(),
    create_policy: SExprSchema.optional(),
    update_policy: SExprSchema.optional(),
    delete_policy: SExprSchema.optional(),
    access_waivers: z
      .object({
        read: z.string().optional(),
        create: z.string().optional(),
        update: z.string().optional(),
        delete: z.string().optional(),
      })
      .optional(),
    invariants: z.array(SExprSchema).optional(),
  }),
  z.object({
    strict: z.boolean().optional(),
    kind: z.literal("event"),
    traitName: z.string().min(1, "Expected event trait name is required"),
    event: z.string().min(1, "Expected event name is required"),
    payload: z.array(EventPayloadFieldSchema).optional(),
  }),
  z.object({
    strict: z.boolean().optional(),
    kind: z.literal("page"),
    path: z.string().min(1, "Expected page path is required"),
    traits: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    strict: z.boolean().optional(),
    kind: z.literal("state"),
    traitName: z.string().min(1, "Expected state trait name is required"),
    state: z.string().min(1, "Expected state name is required"),
    holds: SExprSchema.optional(),
  }),
  z.object({
    strict: z.boolean().optional(),
    kind: z.literal("transition"),
    traitName: z.string().min(1, "Expected transition trait name is required"),
    from: z.string().min(1),
    event: z.string().min(1),
    to: z.string().min(1),
    ensures: SExprListSchema.optional(),
  }),
  z.object({
    strict: z.boolean().optional(),
    kind: z.literal("config"),
    name: z.string().min(1, "Expected config knob name is required"),
    knob: ConfigFieldDeclarationSchema,
  }),
]);

/** A cross-boundary usage `orb behaviors expects` could not turn into a declaration. */
export const ExpectationDiagnosticSchema = z
  .object({
    kind: z.enum(["unknown-orbital", "identity-field-not-declared", "entity-field-not-declared", "event-source-unknown"]),
    orbital: z.string(),
    entity: z.string().optional(),
    field: z.string().optional(),
  })
  .strict();
export type ExpectationDiagnostic = z.infer<typeof ExpectationDiagnosticSchema>;

/**
 * What `orb behaviors expects <organism>` prints: every orbital's derived `expects`
 * (docs/Almadar_LOLO_Expects_Proposal.md §7; the derivation lives in `orbital-core`).
 */
export const OrganismExpectationsSchema = z.record(
  z.object({ expectations: z.array(ExpectDeclarationSchema), diagnostics: z.array(ExpectationDiagnosticSchema) }).strict(),
);
export type OrganismExpectations = z.infer<typeof OrganismExpectationsSchema>;

// ============================================================================
// Entity Reference (Inline OR Reference)
// ============================================================================

/**
 * EntityCall - Reference to an imported entity with optional override arguments.
 *
 * Treats the imported entity as a callable function: the atom's declared
 * fields are defaults and the caller can append extra fields, rename, or
 * override persistence/collection. The discriminator key is `extends` to
 * stay consistent with the Phase A.5 Rust schema (`EntityRef::Extends`).
 *
 * @example
 * ```json
 * // Inherit ModalRecord's fields, rename to CartItem, add pendingId
 * {
 *   "extends": "Modal.entity",
 *   "name": "CartItem",
 *   "fields": [{ "name": "pendingId", "type": "string" }]
 * }
 * ```
 */
export type EntityCall = {
  /** Reference to the imported entity using the "extends" discriminator key */
  extends: string;
  /** V4 dual-carry id sibling of `extends` — optional until the Phase-7 flip. */
  extendsId?: EntityId;
  /** Optional rename for the resulting entity */
  name?: string;
  /** Additional fields appended to the inherited set (caller wins on name collision) */
  fields?: EntityField[];
  /** Optional persistence override */
  persistence?: EntityPersistence;
  /** Optional collection override */
  collection?: string;
};

/**
 * EntityRef - Entity can be inline definition OR reference to imported entity.
 *
 * Reference formats:
 * - Simple string: "Alias.entity"
 * - Call form (with overrides): { extends: "Alias.entity", name?, fields?, persistence?, collection? }
 *
 * @example
 * ```json
 * // Inline
 * { "entity": { "name": "Player", "fields": [...] } }
 *
 * // Simple reference
 * { "entity": "Goblin.entity" }
 *
 * // Call form with overrides (Phase F)
 * { "entity": { "extends": "Modal.entity", "name": "CartItem", "fields": [...] } }
 * ```
 */
export type EntityRef = Entity | string | EntityCall;

/**
 * Checks if an entity reference is a string reference.
 *
 * Type guard to determine if an EntityRef is a string reference
 * (format: "Alias.entity") rather than an inline entity definition or
 * an EntityCall object.
 *
 * Note: This guard intentionally narrows to `string` only. To check for
 * any non-inline form (string OR EntityCall), use `isEntityReferenceAny`.
 *
 * @param {EntityRef} entity - Entity reference to check
 * @returns {boolean} True if entity is a string reference, false otherwise
 *
 * @example
 * const ref1 = "User.entity"; // string reference
 * const ref2 = { name: "User", fields: [...] }; // inline definition
 * const ref3 = { extends: "User.entity" }; // EntityCall
 *
 * isEntityReference(ref1); // returns true
 * isEntityReference(ref2); // returns false
 * isEntityReference(ref3); // returns false
 */
export function isEntityReference(entity: EntityRef): entity is string {
  return typeof entity === "string";
}

/**
 * Checks if an entity reference is an EntityCall (extends form).
 *
 * Type guard for the call-form EntityRef introduced in Phase F. EntityCall
 * is identified by the presence of the "extends" discriminator key.
 *
 * @param {EntityRef} entity - Entity reference to check
 * @returns {boolean} True if entity is an EntityCall object
 *
 * @example
 * isEntityCall({ extends: "Modal.entity", name: "CartItem" }); // returns true
 * isEntityCall("Modal.entity"); // returns false
 * isEntityCall({ name: "Modal", fields: [] }); // returns false
 */
export function isEntityCall(entity: EntityRef): entity is EntityCall {
  return typeof entity === "object" && entity !== null && "extends" in entity;
}

/**
 * Checks if an entity reference is any non-inline form (string or EntityCall).
 *
 * Broader companion to `isEntityReference` that recognizes both the bare
 * string reference and the Phase F EntityCall form.
 *
 * @param {EntityRef} entity - Entity reference to check
 * @returns {boolean} True if entity is a string reference or EntityCall
 */
export function isEntityReferenceAny(
  entity: EntityRef,
): entity is string | EntityCall {
  return isEntityReference(entity) || isEntityCall(entity);
}

/**
 * Validate entity reference format: "Alias.entity", or the placeholder a
 * reference-form orbital carries before inline, "Alias.orbitals.Name.entity".
 */
export const EntityRefStringSchema = z
  .string()
  .regex(
    /^[A-Z][a-zA-Z0-9]*(\.orbitals\.[A-Z][a-zA-Z0-9]*)?\.entity$/,
    'Entity reference must be in format "Alias.entity" (e.g., "Goblin.entity") or "Alias.orbitals.Name.entity"',
  );

/**
 * Validate EntityCall (extends form) shape.
 *
 * Phase F.4 refines:
 * - The `fields` override array must not contain duplicate field names
 *   (case-sensitive). Duplicates would silently shadow each other during
 *   the inliner's field-merge step, so reject at the schema boundary.
 */
export const EntityCallSchema = z
  .object({
    extends: z
      .string()
      .regex(
        /^[A-Z][a-zA-Z0-9]*\.entity$/,
        'EntityCall "extends" must be in format "Alias.entity"',
      ),
    name: z.string().optional(),
    fields: z.array(EntityFieldSchema).optional(),
    persistence: EntityPersistenceSchema.optional(),
    collection: z.string().optional(),
  })
  .refine(
    (call) => {
      if (!call.fields) return true;
      const seen = new Set<string>();
      for (const field of call.fields) {
        if (field.name === undefined) continue;
        if (seen.has(field.name)) return false;
        seen.add(field.name);
      }
      return true;
    },
    {
      message:
        'EntityCall "fields" override list must not contain duplicate field names',
      path: ["fields"],
    },
  );

export const EntityRefSchema = z.union([
  EntitySchema,
  EntityRefStringSchema,
  EntityCallSchema,
]);

// ============================================================================
// Page Reference (Inline OR Reference)
// ============================================================================

/**
 * PageRefObject - Reference to imported page with optional override arguments.
 *
 * Phase F adds `linkedEntity` and `traits` arguments so a caller can rebind
 * the imported page's entity and trait set, treating the page as a callable
 * function.
 */
export type PageRefObject = {
  /**
   * Reference to imported page: "Alias.pages.PageName"
   */
  ref: string;

  /** V4 dual-carry id sibling of `ref` — optional until the Phase-7 flip. */
  refId?: PageId;

  /**
   * Phase 1.2: optional registry path disambiguator. Pairs with `ref` to
   * explicitly name which `uses` entry the alias was imported from
   * (e.g. "std/behaviors/atoms/std-browse"). Helpful for programmatic
   * descriptor construction and inline-phase disambiguation when multiple
   * registries expose the same alias prefix.
   */
  from?: string;

  /**
   * Optional path override.
   * If provided, overrides the original page's path.
   */
  path?: string;

  /**
   * Phase F: rebind the page's entity to the caller's entity.
   * Identifier-substitution pass rewrites references to the original
   * entity inside the imported page.
   */
  linkedEntity?: string;

  /** V4 dual-carry id sibling of `linkedEntity` — optional until the Phase-7 flip. */
  linkedEntityId?: EntityId;

  /**
   * Phase F: override the page's trait set with the caller-supplied list.
   * Each entry may be a string trait reference or an inline trait reference object.
   */
  traits?: TraitRef[];

  /** V4 dual-carry id sibling of `traits` — optional until the Phase-7 flip. */
  traitRefIds?: TraitId[];

  /** Explicit page-modifier overrides; absent fields inherit the upstream page's. */
  access?: PageAccess;
  indexing?: PageIndexing;
  title?: PageMeta;
  description?: PageMeta;
  /** `translationOf:` — the translation group this page belongs to. */
  translationOf?: string;
  /** The page's nav entry (`@label`/`@icon`/`@roles`). */
  label?: string;
  icon?: string;
  roles?: string[];
};

/**
 * PageRef - Page can be inline definition OR reference to imported page.
 *
 * Reference formats:
 * - "Alias.pages.PageName" - Simple reference (keeps original path)
 * - { ref: "Alias.pages.PageName", path: "/custom" } - Reference with path override
 *
 * @example
 * ```json
 * // Inline
 * { "name": "Dashboard", "path": "/", ... }
 *
 * // Simple reference
 * "User.pages.Profile"
 *
 * // Reference with path override
 * { "ref": "User.pages.Profile", "path": "/my-profile" }
 * ```
 */
export type PageRef = Page | string | PageRefObject;

/**
 * Checks if a page reference is a string reference.
 * 
 * Type guard to determine if a PageRef is a simple string reference
 * (format: "Alias.pages.PageName") rather than an inline page definition or object reference.
 * 
 * @param {PageRef} page - Page reference to check
 * @returns {boolean} True if page is a string reference, false otherwise
 * 
 * @example
 * const ref1 = "User.pages.Profile"; // string reference
 * const ref2 = { name: "Dashboard", path: "/" }; // inline definition
 * 
 * isPageReferenceString(ref1); // returns true
 * isPageReferenceString(ref2); // returns false
 */
export function isPageReferenceString(page: PageRef): page is string {
  return typeof page === "string";
}

/**
 * Checks if a page reference is a reference object.
 * 
 * Type guard to determine if a PageRef is an object reference
 * with a 'ref' property rather than an inline page definition.
 * 
 * @param {PageRef} page - Page reference to check
 * @returns {boolean} True if page is a reference object, false otherwise
 * 
 * @example
 * const ref1 = { ref: "User.pages.Profile", path: "/custom" }; // reference object
 * const ref2 = { name: "Dashboard", path: "/" }; // inline definition
 * 
 * isPageReferenceObject(ref1); // returns true
 * isPageReferenceObject(ref2); // returns false
 */
export function isPageReferenceObject(page: PageRef): page is PageRefObject {
  return typeof page === "object" && "ref" in page && !("name" in page);
}

/**
 * Checks if a page reference is any type of reference.
 * 
 * Type guard to determine if a PageRef is a reference (string or object)
 * rather than an inline page definition.
 * 
 * @param {PageRef} page - Page reference to check
 * @returns {boolean} True if page is a reference, false if inline definition
 * 
 * @example
 * const ref1 = "User.pages.Profile"; // string reference
 * const ref2 = { ref: "User.pages.Profile", path: "/custom" }; // object reference
 * const ref3 = { name: "Dashboard", path: "/" }; // inline definition
 * 
 * isPageReference(ref1); // returns true
 * isPageReference(ref2); // returns true
 * isPageReference(ref3); // returns false
 */
export function isPageReference(page: PageRef): page is string | PageRefObject {
  return isPageReferenceString(page) || isPageReferenceObject(page);
}

/**
 * Validate page reference format: "Alias.pages.PageName"
 */
export const PageRefStringSchema = z
  .string()
  .regex(
    /^[A-Z][a-zA-Z0-9]*\.pages\.[A-Z][a-zA-Z0-9]*$/,
    'Page reference must be in format "Alias.pages.PageName" (e.g., "User.pages.Profile")',
  );

export const PageRefObjectSchema = z.object({
  ref: PageRefStringSchema,
  refId: PageIdSchema.optional(),
  // Phase 1.2: optional registry path disambiguator, pairs with `ref`.
  from: z.string().optional(),
  path: z.string().startsWith("/").optional(),
  linkedEntity: z.string().optional(),
  linkedEntityId: EntityIdSchema.optional(),
  traits: z.array(TraitRefSchema).optional(),
  traitRefIds: z.array(TraitIdSchema).optional(),
  access: PageAccessSchema.optional(),
  indexing: PageIndexingSchema.optional(),
  title: PageMetaSchema.optional(),
  description: PageMetaSchema.optional(),
  translationOf: z.string().min(1).optional(),
  label: z.string().optional(),
  icon: z.string().optional(),
  roles: z.array(z.string().min(1)).min(1).optional(),
});

export const PageRefSchema = z.union([
  PageSchema,
  PageRefStringSchema,
  PageRefObjectSchema,
]);

// ============================================================================
// Orbital Reference
// ============================================================================

/**
 * OrbitalRefObject - Reference to an imported orbital ("Alias.orbitals.OrbitalName"),
 * mirroring PageRefObject/TraitRef's reference-with-overrides shape.
 *
 * Set on `OrbitalDefinition.reference` by lowering and cleared by the
 * compiler's inline phase / runtime's resolver — transient, never present on
 * a fully resolved orbital.
 */
export type OrbitalRefObject = {
  /** Reference to imported orbital: "Alias.orbitals.OrbitalName" */
  ref: string;

  /** V4 dual-carry id sibling of `ref` — optional until the Phase-7 flip. */
  refId?: OrbitalId;

  /** `entity E` — rebind the primary entity (bare name). */
  entity?: string;

  /** `fields { up: local }` — primary-entity field renames. */
  fields?: Readonly<Record<string, string>>;

  /** `pages { "/up": "/local" }` — route remap; unmapped paths keep the upstream value. */
  pages?: Readonly<Record<string, string>>;

  /** `pages { "/up": "/local" [access: …] }` — page modifiers per remap entry, keyed by the upstream path. */
  pageModifiers?: Readonly<Record<string, PageModifiers>>;

  /** Trim the imported trait set to everything but these. */
  omit?: readonly string[];

  /** Trim the imported trait set to only these. */
  only?: readonly string[];

  /** Overrides of the upstream orbital's DECLARED knobs only. */
  config?: DeclaredTraitConfig;

  /** `events { UP: LOCAL }` — orbital-scope rename over every trait's emits + listen keys. */
  events?: Readonly<Record<string, string>>;

  /**
   * `roles { approver: [owner, project_manager]  employee: team_member }` —
   * remap the upstream's role literals to the consumer roster. Values are
   * ALWAYS arrays, even for a single target: one target is a literal swap
   * (`(= @user.role "approver")` → `(= @user.role "owner")`); a list rewrites
   * an equality comparison into `(array/includes [...] @user.role)` (and
   * wraps `!=`/`neq` in `not`), and expands the literals of an existing
   * `array/includes` haystack. Every target must be a member of the
   * consumer's `[identity]` role vocabulary.
   */
  roles?: Readonly<Record<string, readonly string[]>>;

  /**
   * `entities { Employee: Person }` — retarget an out-of-orbital relation
   * (an entity named by the imported closure but declared by another
   * orbital of the same upstream alias) to a consumer entity. Applied to
   * relation targets, `@Entity` tokens, fetch/persist targets, policy
   * comparisons, and page `primaryEntity` / `sourceEntityDefinition`.
   * `entity E` (the primary rebind) is a separate field, not part of this map.
   */
  entities?: Readonly<Record<string, string>>;

  /**
   * `pages { "/up": "/local" -> TraitA, TraitB }` — sibling traits mounted
   * onto the remapped page, keyed by the UPSTREAM page path. These traits
   * ride the reference body unprefixed; `omit`/`only` never apply to them.
   */
  mounts?: Readonly<Record<string, readonly string[]>>;

  /**
   * `extend { field : type = default }` — ADD fields to the upstream primary
   * entity (full entity-field syntax; `fields {}` stays rename-only). Applied
   * after `fields {}` renames; a name colliding with the upstream primary
   * (post-rename) or a `fields {}` rename target refuses resolution
   * (`ORB_O_EXTEND_FIELD_COLLISION`). A relation-typed added field's target
   * resolves in the CONSUMER's own scope, never upstream's. An added field
   * no trait of the materialized orbital ever reads/sets/renders/forwards is
   * a `orb validate` WARNING (`ORB_O_EXTEND_FIELD_UNREAD`), not a JS-resolve
   * concern.
   */
  extend?: readonly EntityField[];

  /**
   * `mock { field: "a, b" }` — sample data for fields of the materialized
   * primary entity (named after `fields {}` renames, or an `extend {}` field),
   * replacing the upstream field's `@mock`. A key naming no such field is
   * `ORB_O_MOCK_UNKNOWN_FIELD`.
   */
  mock?: Readonly<Record<string, string>>;

  /**
   * `retype { field : type = default }` — replace the type/default of fields the
   * upstream primary entity already declares (named after `fields {}` renames).
   * Unlike `extend {}`, every name MUST exist (`ORB_O_RETYPE_UNKNOWN_FIELD`); a
   * field also in `extend {}` or listed twice is `ORB_O_RETYPE_FIELD_CONFLICT`.
   */
  retype?: readonly EntityField[];

  /**
   * `entity Name [persistent: tbl]` — override the materialized primary entity's
   * persistence mode. Refused when the upstream entity is not `persistent`
   * (`ORB_O_ENTITY_PERSISTENCE_LOCKED`), the factory-runtime rule.
   */
  persistence?: EntityPersistence;

  /** `entity Name [persistent: tbl]` — override the primary entity's collection. */
  collection?: string;

  /** Entity-header flags of the `entity` line; each switches the flag ON. */
  shared?: boolean;
  identity?: boolean;
  local?: boolean;
  /** `[mock]` — seed an empty browser store from the shared mock seeder. */
  seedMock?: boolean;

  /**
   * `traits { UpstreamTrait { … } }` — per-imported-trait overrides keyed by the
   * trait's UPSTREAM name (the §8 trait-reference body). A key naming no upstream
   * trait is `ORB_O_TRAITS_UNKNOWN_TRAIT`; one `omit`/`only` dropped is
   * `ORB_O_TRAITS_OMITTED_TRAIT`; a config key the trait never declares is
   * `ORB_O_CONFIG_UNKNOWN_KEY`.
   */
  traits?: Readonly<Record<string, OrbitalRefTraitOverride>>;

  /**
   * `listens { Source.EVENT -> Target.TRIGGER }` — declared routes INTO the
   * imported set. Each entry appends one listen to the imported trait named
   * by `trait` (upstream name). A source naming an imported trait follows
   * the prefix; any other source is a host sibling and keeps its name. The
   * trigger is in the post-`events {}` vocabulary. A target outside the
   * imported set (after omit/only) refuses resolution
   * (`ORB_O_LISTEN_TARGET_UNKNOWN`).
   */
  listens?: readonly OrbitalRefListen[];
};

/** One orbital-import `traits {}` entry: the trait-reference override surface for one imported trait. */
export type OrbitalRefTraitOverride = {
  /** `-> Entity`: rebinds the trait's linked entity. */
  linkedEntity?: string;
  config?: DeclaredTraitConfig;
  events?: Readonly<Record<string, string>>;
  fields?: Readonly<Record<string, string>>;
  /** Replaces the trait's whole `listens` array. */
  listens?: readonly TraitEventListener[];
  emitsScope?: EventScope;
};

/** One orbital-import `listens {}` entry: the target imported trait plus an ordinary listen. */
export type OrbitalRefListen = TraitEventListener & { trait: string };

/**
 * Validate orbital reference format: "Alias.orbitals.OrbitalName"
 */
export const OrbitalRefStringSchema = z
  .string()
  .regex(
    /^[A-Z][a-zA-Z0-9]*\.orbitals\.[A-Z][a-zA-Z0-9]*$/,
    'Orbital reference must be "Alias.orbitals.OrbitalName"',
  );

export const OrbitalRefObjectSchema = z.object({
  ref: OrbitalRefStringSchema,
  refId: OrbitalIdSchema.optional(),
  entity: z.string().optional(),
  fields: z.record(z.string()).optional(),
  pages: z.record(z.string()).optional(),
  pageModifiers: z.record(z.string(), PageModifiersSchema).optional(),
  omit: z.array(z.string()).optional(),
  only: z.array(z.string()).optional(),
  config: DeclaredTraitConfigSchema.optional(),
  events: z.record(z.string()).optional(),
  roles: z.record(z.string(), z.array(z.string())).optional(),
  entities: z.record(z.string(), z.string()).optional(),
  mounts: z.record(z.string(), z.array(z.string())).optional(),
  extend: z.array(EntityFieldSchema).optional(),
  mock: z.record(z.string(), z.string()).optional(),
  retype: z.array(EntityFieldSchema).optional(),
  persistence: EntityPersistenceSchema.optional(),
  collection: z.string().optional(),
  shared: z.boolean().optional(),
  identity: z.boolean().optional(),
  local: z.boolean().optional(),
  seedMock: z.boolean().optional(),
  traits: z
    .record(
      z.string(),
      z.object({
        linkedEntity: z.string().optional(),
        config: DeclaredTraitConfigSchema.optional(),
        events: z.record(z.string()).optional(),
        fields: z.record(z.string()).optional(),
        listens: z.array(TraitEventListenerSchema).optional(),
        emitsScope: EventScopeSchema.optional(),
      }),
    )
    .optional(),
  listens: z.array(TraitEventListenerSchema.extend({ trait: z.string() })).optional(),
});

/**
 * Parses an orbital reference.
 *
 * Extracts the alias and orbital name from an orbital reference
 * in format "Alias.orbitals.OrbitalName". Returns null if not a valid orbital reference.
 *
 * @param {string} ref - Orbital reference to parse
 * @returns {{ alias: string; orbitalName: string } | null} Parsed reference or null
 *
 * @example
 * parseOrbitalRef("TimeTracking.orbitals.TimesheetPanelOrbital"); // returns { alias: "TimeTracking", orbitalName: "TimesheetPanelOrbital" }
 * parseOrbitalRef("TimeTracking.traits.X"); // returns null
 */
export function parseOrbitalRef(
  ref: string,
): { alias: string; orbitalName: string } | null {
  const match = ref.match(/^([A-Z][a-zA-Z0-9]*)\.orbitals\.([A-Z][a-zA-Z0-9]*)$/);
  if (!match) return null;
  return { alias: match[1], orbitalName: match[2] };
}

// ============================================================================
// Trait Reference Extensions
// ============================================================================

/**
 * Extended trait reference format for imported traits.
 *
 * Formats:
 * - "TraitName" - Local trait (inline or from uses without alias)
 * - "Alias.traits.TraitName" - Imported trait with namespace
 *
 * The existing TraitRef type already supports these via string.
 */

/**
 * Validate trait reference format for imported traits.
 */
export const ImportedTraitRefStringSchema = z
  .string()
  .regex(
    /^([A-Z][a-zA-Z0-9]*\.traits\.)?[A-Z][a-zA-Z0-9]*$/,
    'Trait reference must be "TraitName" or "Alias.traits.TraitName"',
  );

/**
 * Checks if a trait reference is an imported reference.
 * 
 * Determines if a trait reference uses the imported format
 * "Alias.traits.TraitName" rather than a simple "TraitName".
 * 
 * @param {string} ref - Trait reference to check
 * @returns {boolean} True if reference is imported format, false otherwise
 * 
 * @example
 * isImportedTraitRef("User.traits.Profile"); // returns true
 * isImportedTraitRef("Profile"); // returns false
 */
export function isImportedTraitRef(ref: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*\.traits\.[A-Z][a-zA-Z0-9]*$/.test(ref);
}

/**
 * Parses an imported trait reference.
 * 
 * Extracts the alias and trait name from an imported trait reference
 * in format "Alias.traits.TraitName". Returns null if not a valid imported reference.
 * 
 * @param {string} ref - Trait reference to parse
 * @returns {{ alias: string; traitName: string } | null} Parsed reference or null
 * 
 * @example
 * parseImportedTraitRef("User.traits.Profile"); // returns { alias: "User", traitName: "Profile" }
 * parseImportedTraitRef("Profile"); // returns null
 */
export function parseImportedTraitRef(
  ref: string,
): { alias: string; traitName: string } | null {
  const match = ref.match(/^([A-Z][a-zA-Z0-9]*)\.traits\.([A-Z][a-zA-Z0-9]*)$/);
  if (!match) return null;
  return { alias: match[1], traitName: match[2] };
}

/**
 * Parses an entity reference.
 * 
 * Extracts the alias from an entity reference in format "Alias.entity".
 * Returns null if not a valid entity reference.
 * 
 * @param {string} ref - Entity reference to parse
 * @returns {{ alias: string } | null} Parsed reference or null
 * 
 * @example
 * parseEntityRef("User.entity"); // returns { alias: "User" }
 * parseEntityRef("User"); // returns null
 */
export function parseEntityRef(ref: string): { alias: string } | null {
  const match = ref.match(/^([A-Z][a-zA-Z0-9]*)\.entity$/);
  if (!match) return null;
  return { alias: match[1] };
}

/**
 * Parses a page reference.
 * 
 * Extracts the alias and page name from a page reference
 * in format "Alias.pages.PageName". Returns null if not a valid page reference.
 * 
 * @param {string} ref - Page reference to parse
 * @returns {{ alias: string; pageName: string } | null} Parsed reference or null
 * 
 * @example
 * parsePageRef("User.pages.Profile"); // returns { alias: "User", pageName: "Profile" }
 * parsePageRef("Profile"); // returns null
 */
export function parsePageRef(
  ref: string,
): { alias: string; pageName: string } | null {
  const match = ref.match(/^([A-Z][a-zA-Z0-9]*)\.pages\.([A-Z][a-zA-Z0-9]*)$/);
  if (!match) return null;
  return { alias: match[1], pageName: match[2] };
}

// ============================================================================
// Event Listener (Legacy)
// ============================================================================

/**
 * Event listener for cross-orbital communication (legacy format).
 * @deprecated Use trait-level listens with scope instead.
 */
export interface EventListener {
  /** Event key to listen for */
  event: string;
  /** Action to trigger */
  triggers: string;
  /** Optional guard condition */
  guard?: string;
}

export const EventListenerSchema = z.object({
  event: z.string().min(1),
  triggers: z.string().min(1),
  guard: z.string().optional(),
});

// ============================================================================
// Computed Event Contract (Trait-Centric Model)
// ============================================================================

/**
 * Source of an event - which trait/transition/tick emits it.
 */
export type EventSource = {
  /** Trait that emits this event */
  trait: string;
  /** Transition that emits this event (if applicable) */
  transition?: string;
  /** Tick that emits this event (if applicable) */
  tick?: string;
};

export const EventSourceSchema = z.object({
  trait: z.string().min(1),
  transition: z.string().optional(),
  tick: z.string().optional(),
});

/**
 * Computed event contract with source tracking.
 * Generated by aggregating trait-level emits with namespacing.
 */
export type ComputedEventContract = {
  /** Namespaced event: "TraitName.EVENT_NAME" */
  event: string;
  /** Original event name without namespace */
  originalEvent: string;
  /** Source trait that emits this event */
  source: EventSource;
  /** Human-readable description */
  description?: string;
  /** Payload schema */
  payload?: EventPayloadField[];
};

export const ComputedEventContractSchema = z.object({
  event: z.string().min(1),
  originalEvent: z.string().min(1),
  source: EventSourceSchema,
  description: z.string().optional(),
  payload: z.array(EventPayloadFieldSchema).optional(),
});

/**
 * Computed event listener with source tracking.
 * Generated by aggregating trait-level listens.
 */
export type ComputedEventListener = {
  /** Event to listen for (may be namespaced) */
  event: string;
  /** Source trait that defines this listener */
  source: EventSource;
  /** State machine event to trigger */
  triggers: string;
  /** Guard expression */
  guard?: Expression;
  /** `with { ... }` payload rewrite: `{ targetField: SExpr }`, evaluated against the source payload. */
  payloadMapping?: Record<string, SExpr>;
};

export const ComputedEventListenerSchema = z.object({
  event: z.string().min(1),
  source: EventSourceSchema,
  triggers: z.string().min(1),
  guard: ExpressionSchema.optional(),
  payloadMapping: z.record(SExprSchema).optional(),
});

// ============================================================================
// Orbital
// ============================================================================

/**
 * Orbital - The atomic building block of applications.
 *
 * Formula: Orbital = Entity × Traits × Pages
 *
 * An orbital is a self-contained feature unit that groups:
 * - One entity (the data nucleus) - inline OR referenced via "Alias.entity"
 * - Zero or more traits (behavioral patterns) - inline OR referenced via "Alias.traits.X"
 * - Zero or more pages (UI entry points) - inline OR referenced via "Alias.pages.X"
 *
 * Use `uses` to import other orbitals and access their components.
 */
export type Orbital = OrbitalDefinition;

export type OrbitalDefinition = {
  /** V4 dual-carry id sibling of `name` — optional until the Phase-7 flip. */
  id?: OrbitalId;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Visual prompt override */
  visual_prompt?: string;

  // ========================================================================
  // Import System (Unified Reference)
  // ========================================================================

  /**
   * Import external orbitals as namespaces.
   *
   * After importing, access components via:
   * - Alias.entity - The entity definition
   * - Alias.traits.TraitName - A specific trait
   * - Alias.pages.PageName - A specific page
   * - Alias.theme - The theme definition
   * - Alias.services.ServiceName - A specific service
   *
   * @example
   * ```json
   * "uses": [
   *   { "from": "./health.orb", "as": "Health" },
   *   { "from": "std/behaviors/game-core", "as": "GameCore" }
   * ]
   * ```
   */
  uses?: UseDeclaration[];

  /**
   * Consumer-side requirement declarations (`.lolo` `expects ...`).
   *
   * Promises about sibling orbitals this unit relies on: trusted as the
   * local type environment when the orbital is validated standalone,
   * link-checked against real providers at compose. Compile-time only —
   * runtime semantics are unchanged.
   * See docs/Almadar_LOLO_Expects_Proposal.md.
   */
  expects?: ExpectDeclaration[];

  /** An orbital of only `expects` lines: a spec. It provides nothing; its obligations bind the orbital that imports it. */
  spec?: boolean;

  // ========================================================================
  // Theme & Services
  // ========================================================================

  /**
   * Theme definition (inline OR reference via "Alias.theme").
   *
   * @example
   * ```json
   * // Inline
   * "theme": { "name": "ocean", "tokens": { "colors": { "primary": "#0ea5e9" } } }
   *
   * // Reference
   * "theme": "Ocean.theme"
   * ```
   */
  theme?: ThemeRef;

  /**
   * Service definitions (inline OR reference via "Alias.services.ServiceName").
   *
   * @example
   * ```json
   * // Inline
   * "services": [{ "name": "weather", "type": "rest", "baseUrl": "..." }]
   *
   * // Reference
   * "services": ["Weather.services.openweather"]
   * ```
   */
  services?: ServiceRef[];

  // ========================================================================
  // Components (Inline OR Reference)
  // ========================================================================

  /**
   * Entity definition (nucleus).
   *
   * Can be:
   * - Inline: Full entity definition
   * - Reference: "Alias.entity" (from uses)
   *
   * Entity sharing depends on persistence type:
   * - persistent: Shared (same DB collection)
   * - runtime: Isolated (each orbital gets own instances)
   */
  entity: EntityRef;

  /**
   * Imported atom entities surfaced into this orbital's resolution
   * scope WITHOUT modifying the primary `entity`. Populated by the
   * compiler's inline phase when a trait reference imports an atom
   * and OMITS the `-> Entity` linkedEntity rebind: the atom keeps its
   * own entity (e.g. `SearchResult` from std-search), and that entity
   * is registered here so validators / codegen / runtime can resolve
   * `linkedEntity = "SearchResult"` lookups, register persistence for
   * it, and emit its TypeScript type alongside the primary entity.
   * The orbital's per-trait entity arity stays 1:1 — this is purely a
   * NAME-RESOLUTION side channel for cross-import linkedEntity
   * references.
   */
  auxiliaryEntities?: EntityRef[];

  /** Trait references (local or imported via "Alias.traits.TraitName") */
  traits: TraitRef[];

  /**
   * Page definitions.
   *
   * Can be:
   * - Inline: Full page definition
   * - Reference string: "Alias.pages.PageName"
   * - Reference object: { ref: "Alias.pages.PageName", path: "/custom" }
   */
  pages: PageRef[];

  // ========================================================================
  // Event Interface (Trait-Centric Model)
  // ========================================================================

  /**
   * Events this orbital emits.
   *
   * COMPUTED from trait-level emits:
   * - Aggregated from all traits with `scope: 'external'`
   * - Namespaced as "TraitName.EVENT_NAME"
   * - Filtered by `exposes` if present
   *
   * Do not author directly - computed by resolver.
   */
  emits?: ComputedEventContract[];

  /**
   * Events this orbital listens for.
   *
   * COMPUTED from trait-level listens:
   * - Aggregated from all traits with `scope: 'external'`
   *
   * Do not author directly - computed by resolver.
   */
  listens?: ComputedEventListener[];

  /**
   * Filter which trait events are exposed externally.
   * If omitted, all external-scoped trait events are exposed.
   * Format: ["TraitName.EVENT_NAME", ...]
   */
  exposes?: string[];

  /** `os-grants { … }` — the `os/` permissions this orbital holds beyond the program's. */
  osGrants?: OsGrants;

  /**
   * This orbital's own DECLARED knobs (§4.5) — distinct from `OrbitalSchema.config`,
   * which declares organism-wide knobs shared by every orbital. Traits publish a
   * knob by forwarding `@config.<knob>`; an importer overrides via
   * `OrbitalRefObject.config` or `UseDeclaration.config`.
   */
  config?: DeclaredTraitConfig;

  /**
   * TRANSIENT — set by lowering when this orbital is authored as
   * `orbital X = Alias.orbitals.Y { ... }` (the reference form). Cleared by
   * the compiler's inline phase / runtime's resolver during flattening; must
   * never reach validation, codegen, or a committed `.orb`.
   */
  reference?: OrbitalRefObject;

  // ========================================================================
  // Context fields - persisted throughout orbital lifecycle
  // ========================================================================

  /** Domain context - category, vocabulary, personas */
  domainContext?: DomainContext;

  /** Design preferences - style, colors, UX hints */
  design?: DesignPreferences;

  /**
   * Suggested guards (decomposition phase only).
   * Natural language descriptions that generator converts to S-expressions.
   * Removed after generation - guards live in traits.
   */
  suggestedGuards?: SuggestedGuard[];

  /**
   * This orbital's own named STRUCT aliases (`type X = { ... }`), each
   * flattened to the same payload-field tree emit/listen payloads use.
   * The `.orb`'s only record of a struct alias post-L1 — a Type-kind trait
   * type-param arg (`:: p SomeStructAlias`) resolves against this map.
   * Enum/primitive/entity aliases are NOT carried here (not legal `::`
   * args). A dictionary or list alias (`Map string string`, `[string]`) is one
   * unnamed member (`name: ''`) carrying the type string; a tagged union alias is one
   * unnamed member typed `union` whose `properties` are its variants.
   */
  types?: Record<string, EventPayloadField[]>;
};

/**
 * A named type alias of an orbital: a record alias is its fields; a dictionary or list alias
 * (`type Cells = Map string string`) is one unnamed member carrying the type string; a tagged union alias
 * (`type Item = Shape | Text`) is one unnamed member typed `union` whose properties are its variants.
 */
const TypeAliasMembersSchema = z.union([
  z.array(EventPayloadFieldSchema),
  z.tuple([
    z.object({
      name: z.literal(''),
      type: z.string().min(1),
      // A tagged union alias is the unnamed member `union`, its variants the properties.
      properties: z.array(EventPayloadFieldSchema).optional(),
    }),
  ]),
]);

export const OrbitalDefinitionSchema = z.object({
  id: OrbitalIdSchema.optional(),
  name: z.string().min(1, "Orbital name is required"),
  description: z.string().optional(),
  visual_prompt: z.string().optional(),
  // Import system
  uses: z.array(UseDeclarationSchema).optional(),
  // Consumer-side requirement declarations (`.lolo` `expects ...`)
  expects: z.array(ExpectDeclarationSchema).optional(),
  spec: z.boolean().optional(),
  // Theme & Services
  theme: ThemeRefSchema.optional(),
  services: z.array(ServiceRefSchema).optional(),
  // Components (inline or reference)
  entity: EntityRefSchema,
  // Mirrors the `OrbitalDefinition.auxiliaryEntities` type field — WAS
  // undeclared here, so `OrbitalSchemaSchema.safeParse` (every load through
  // `external-loader.ts`) silently stripped it on every externally-loaded
  // orbital (zod drops unrecognized keys by default), while a schema parsed
  // directly via `JSON.parse` kept it. Found via the entity-field auto-merge
  // rebind-target fallback landing on the wrong entity for any RECURSIVELY
  // loaded `uses` file (`packages/almadar-runtime/src/resolver/
  // reference-resolver.ts`'s `mergeImportedEntityFieldsIntoOrbital`).
  auxiliaryEntities: z.array(EntityRefSchema).optional(),
  traits: z.array(TraitRefSchema),
  // A reference-form orbital's pages come from its upstream until inline.
  pages: z.array(PageRefSchema).default([]),
  // Event interface (trait-centric model) - computed by resolver
  emits: z.array(ComputedEventContractSchema).optional(),
  listens: z.array(ComputedEventListenerSchema).optional(),
  // Filter for exposed events (trait-centric model)
  exposes: z.array(z.string()).optional(),
  osGrants: OsGrantsSchema.optional(),
  // This orbital's own declared knobs (§4.5)
  config: DeclaredTraitConfigSchema.optional(),
  // Transient — set by lowering, cleared by inline/resolve
  reference: OrbitalRefObjectSchema.optional(),
  // Context fields - persisted throughout orbital lifecycle
  domainContext: DomainContextSchema.optional(),
  design: DesignPreferencesSchema.optional(),
  suggestedGuards: z.array(SuggestedGuardSchema).optional(),
  types: z.record(z.string(), TypeAliasMembersSchema).optional(),
}).superRefine((orbital, ctx) => {
  // The compiler's EntityNoFields, which skips a spec's shell entity (`validate_all_entities`).
  if (orbital.spec === true) return;
  const entities: Array<[EntityRef, (string | number)[]]> = [[orbital.entity, ['entity']], ...(orbital.auxiliaryEntities ?? []).map((e, i): [EntityRef, (string | number)[]] => [e, ['auxiliaryEntities', i]])];
  for (const [entity, path] of entities) {
    if (!isEntityReferenceAny(entity) && entity.fields.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: 1, type: 'array', inclusive: true, path: [...path, 'fields'], message: 'At least one field is required' });
    }
  }
});

export const OrbitalSchema = OrbitalDefinitionSchema;

/**
 * Unwrap a composed trait (`X = Atom.traits.T`) carried as a `{ ref, config?, _resolved }` wrapper to
 * its resolved trait, returning the call-site `config` beside it. A string ref, an inline trait and a
 * wrapper with no `_resolved` come back as they are, with no config.
 */
export function unwrapTraitRef(traitRef: TraitRef): { trait: TraitRef; config?: CallSiteConfig } {
  if (typeof traitRef === 'string' || isInlineTrait(traitRef) || traitRef._resolved === undefined) {
    return { trait: traitRef };
  }
  return traitRef.config === undefined
    ? { trait: traitRef._resolved }
    : { trait: traitRef._resolved, config: traitRef.config };
}

/**
 * The orbitals with every composed-trait wrapper replaced by its inline trait, the call-site `config`
 * folded onto the trait's declared knobs (`mergeCallSiteConfigOverrides`). Pure.
 */
export function inlineTraitRefs(orbitals: readonly OrbitalDefinition[]): OrbitalDefinition[] {
  return orbitals.map((orbital) => ({
    ...orbital,
    traits: orbital.traits.map((traitRef) => {
      const { trait, config } = unwrapTraitRef(traitRef);
      if (config === undefined || typeof trait === 'string' || !isInlineTrait(trait)) return trait;
      return { ...trait, config: mergeCallSiteConfigOverrides(trait.config ?? {}, config) };
    }),
  }));
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an Orbital is a full definition.
 * @deprecated No longer needed since Orbital is always OrbitalDefinition now.
 */
export function isOrbitalDefinition(
  orbital: Orbital,
): orbital is OrbitalDefinition {
  return "entity" in orbital;
}

// ============================================================================
// Type exports
// ============================================================================

export type OrbitalInput = z.input<typeof OrbitalSchema>;

// Backward compatibility
export type OrbitalUnit = Orbital;
export const OrbitalUnitSchema = OrbitalSchema;
