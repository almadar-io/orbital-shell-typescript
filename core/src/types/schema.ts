/**
 * Orbital Schema Type (Self-Contained)
 *
 * Defines the OrbitalSchema - the top-level application definition.
 * An application is a composition of orbitals: App = Σ(Orbitals)
 *
 * @packageDocumentation
 */

import { z } from "zod";
import type { EventPayloadField } from "./trait.js";
import type { Orbital, LazyPage } from "./orbital.js";
import { OrbitalSchema as OrbitalZodSchema, LazyPageSchema, TypeAliasMembersSchema } from "./orbital.js";
import type {
  DomainContext,
  DesignPreferences,
  DesignTokens,
  CustomPatternMap,
} from "./domain.js";
import {
  DomainContextSchema,
  DesignPreferencesSchema,
  DesignTokensSchema,
  CustomPatternMapSchema,
} from "./domain.js";
import type { ServiceDefinition } from "./service.js";
import { ServiceDefinitionSchema } from "./service.js";
import type { Trait, DeclaredTraitConfig } from "./trait.js";
import { DeclaredTraitConfigSchema } from "./trait.js";
import type { IdentityLedger } from "./identity.js";
import { IdentityLedgerSchema } from "./identity.js";
import type { ThemeDefinition, ThemeRef } from "./domain.js";
import { ThemeDefinitionSchema, ThemeRefSchema } from "./domain.js";
import type { RuntimeValue } from "./json.js";
import type { OsGrants, Deployment } from "./os-grants.js";
import { OsGrantsSchema, DeploymentSchema } from "./os-grants.js";

// ============================================================================
// Orbital Schema
// ============================================================================

/**
 * OrbitalSchema - The top-level application definition.
 *
 * An application is a composition of orbitals:
 * App = Σ(Orbitals)
 *
 * Custom traits can be defined at the schema level and referenced
 * by orbitals via TraitRef. This allows LLMs to generate custom
 * traits that aren't in the trait library.
 */
/**
 * One `@config.<knob>` → render-ui prop substitution recorded by the inline
 * phase. Lets a consumer trace a resolved render-ui literal back to the config
 * knob it came from (the `@config.X` string is erased after substitution).
 * Mirrors the Rust `ConfigProvenanceRecord`.
 */
export interface ConfigProvenanceRecord {
  /** Resolved trait name (post call-site rename) owning the render-ui effect. */
  trait: string;
  /** Pattern path within the render-ui tree (e.g. `root.children.0`). */
  patternPath?: string;
  /** The pattern-node prop key whose value was a `@config.X` binding. */
  prop: string;
  /** The config knob name (`X` in `@config.X`). */
  knob: string;
}

/** Compiler-emitted schema metadata — the resolved `.orb` `_metadata` block. */
export interface SchemaMetadata {
  version?: number;
  createdAt?: number;
  source?: string;
  updatedAt?: number;
  /** Config→knob provenance keyed by orbital name. See {@link ConfigProvenanceRecord}. */
  configProvenance?: Record<string, ConfigProvenanceRecord[]>;
  /** For a program with `locales`: each loaded behavior → its source folder, relative to the program's (catalogs at `<folder>/locales/<locale>/<name>.json`). */
  messageSources?: Record<string, string>;
  /** Compiled client programs: where each effect operator the client's traits run executes, for a kernel with no operator table. */
  operatorSites?: Record<string, 'client' | 'server' | 'any'>;
  /** Compiled client programs: the operator-table facts a kernel reads at dispatch. */
  dispatchFacts?: DispatchFacts;
}

/** The operator-table facts a browser kernel reads at dispatch (`emit` busExcluded, `program/dispatch` targetOptions). */
export interface DispatchFacts {
  busExcluded: string[];
  targetOptions: string[];
}

/** App-level site modifiers: `origin`, `icon`, `siteName` (→ `name`), `signIn`. */
export interface SiteMeta {
  /** Canonical production origin, e.g. `https://orb.almadar.io`. */
  origin?: string;
  /** Site icon path served from the public folder. */
  icon?: string;
  /** Site name (og:site_name). */
  name?: string;
  /** Route an `access: authenticated` page sends a non-admitted viewer to. */
  signIn?: string;
}

/**
 * The sign-in route every host provides itself (the compiled shell's login form, the
 * runtime host's sign-in surface). `signIn:` may name it without a page, and no page
 * may be declared on it. Mirrors `orbital-core` `HOST_SIGN_IN_ROUTE`.
 */
export const HOST_SIGN_IN_ROUTE = '/login';

/** Whether `path` is {@link HOST_SIGN_IN_ROUTE}, ignoring a trailing slash. */
export function isHostSignInRoute(path: string): boolean {
  return path.replace(/\/+$/, '') === HOST_SIGN_IN_ROUTE;
}

export const SiteMetaSchema = z.object({
  origin: z.string().url().optional(),
  icon: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  signIn: z.string().startsWith('/').optional(),
}).strict();

/** A program's merged message catalogs: locale → qualified key (`<behavior>:<key>`) → message. `orb resolve` writes one `<stem>.<locale>.json` per locale. */
export type MessageCatalogs = Record<string, Record<string, string>>;

export interface OrbitalSchema {
  types?: Record<string, EventPayloadField[]>;
  typeContractVersion?: 1;
  /** Application name */
  name: string;

  /** Description */
  description?: string;

  /**
   * App-level theme: the skin every orbital's `@currentTheme` seeds from
   * unless the orbital declares its own `theme` (precedence: orbital →
   * app → the runtime's baseline default). Authored as `theme "<key>"` in
   * the `.lolo` app header; a full `<base>-<light|dark>` registry key.
   * Distinct from {@link OrbitalSchema.config} — this names a registry
   * theme, not a declared knob.
   */
  theme?: ThemeRef;

  /**
   * The registry themes the program switches to inside a page (a sub-frame's
   * `data-theme`, a theme switcher's options), beyond its app and orbital
   * themes. Authored as `themes: [<key>, …]` in the `.lolo` app header; each
   * a full `<base>-<light|dark>` registry key.
   */
  themes?: string[];

  /**
   * The theme presets this program references (app and orbital `theme`
   * keys) plus the runtime default, written by `orb` when it compiles the
   * program for a runtime, so a kernel with no installed `@almadar/core`
   * (wasm, mobile) resolves `@currentTheme` from the program alone. Never
   * authored; absent on a source `.orb`.
   */
  themeDefinitions?: ThemeDefinition[];

  /**
   * Short human-readable summary distinct from `description`. Typically an
   * AI-generated one-liner used by app list views, breadcrumbs, and the
   * `GET /graphs/:appId/domain-text` projection. Kept separate from
   * `description` (which may be longer / authored copy) so consumers can
   * present a stable short label without truncating.
   */
  summary?: string;

  /** Version (semver) */
  version?: string;

  /** Domain context - user request + classification */
  domainContext?: DomainContext;

  /** Design preferences */
  design?: DesignPreferences;

  /**
   * Design tokens - reusable Tailwind class collections.
   * Reference via `token: "surfaces.glass"` in patterns.
   */
  designTokens?: DesignTokens;

  /**
   * Custom pattern definitions for app-specific reusable patterns.
   * Register custom designs that can be referenced by name.
   */
  customPatterns?: CustomPatternMap;

  /** Array of orbitals */
  orbitals: Orbital[];

  /** `locales [en, ar, sl]` — the locales this program ships; every `(i18n/t …)` key must exist in each one's catalog. */
  locales?: string[];

  /** `public: "./public"` — a folder beside the program copied verbatim to the built site's root. */
  publicDir?: string;

  /** `app … [store: Driver]` — the default store-driver orbital for persistent entities that name none. */
  store?: string;

  /** Origins (`scheme://host[:port]`) the program's `http` effects may reach. */
  egress?: string[];

  /** `os-grants { … }` — the `os/` permissions the whole program holds; every orbital inherits them. */
  osGrants?: OsGrants;

  /** `deployment { target: [Orbital, …] }` — which orbitals ship to which target. */
  deployment?: Deployment;

  /** `inbound: [...]` — the hook names (`/api/hooks/<name>`) the program accepts deliveries on. */
  inbound?: string[];

  /** Site modifiers from the app bracket (`origin`, `icon`, `siteName`, `signIn`). */
  site?: SiteMeta;

  /** Pages served by `uses lazy` behaviors, each loaded from its own `.orb` when opened. */
  lazyPages?: LazyPage[];

  /** External services */
  services?: ServiceDefinition[];

  /**
   * Organism-level DECLARED knobs (§4.5) — shared by every orbital in this
   * schema, forwarded via `@config.<knob>`. Distinct from `Orbital.config`,
   * which declares one orbital's own knobs.
   */
  config?: DeclaredTraitConfig;

  /** Compiler-emitted metadata (resolved `.orb` `_metadata`). */
  _metadata?: SchemaMetadata;

  /**
   * V4 IR schema version. Distinct from the semver `version` above; gates the
   * identity-keyed reference semantics. Optional/unset for pre-V4 schemas.
   */
  schemaVersion?: number;

  /**
   * V4 identity ledger — the sole name↔id map for this schema's nodes. Optional
   * until the Phase-7 flip; absent on pre-V4 schemas.
   */
  ledger?: IdentityLedger;
}

export const ConfigProvenanceRecordSchema = z.object({
  trait: z.string(),
  patternPath: z.string().optional(),
  prop: z.string(),
  knob: z.string(),
});

export const SchemaMetadataSchema = z.object({
  version: z.number().optional(),
  createdAt: z.number().optional(),
  source: z.string().optional(),
  updatedAt: z.number().optional(),
  configProvenance: z.record(z.array(ConfigProvenanceRecordSchema)).optional(),
  messageSources: z.record(z.string()).optional(),
  operatorSites: z.record(z.enum(['client', 'server', 'any'])).optional(),
  dispatchFacts: z.object({ busExcluded: z.array(z.string()), targetOptions: z.array(z.string()) }).optional(),
});

export const OrbitalSchemaSchema: z.ZodType<OrbitalSchema, z.ZodTypeDef, object> = z.object({
  types: z.record(TypeAliasMembersSchema).optional(),
  typeContractVersion: z.literal(1).optional(),
  name: z.string().min(1, "Schema name is required"),
  description: z.string().optional(),
  theme: ThemeRefSchema.optional(),
  themes: z.array(z.string().min(1)).optional(),
  themeDefinitions: z.array(ThemeDefinitionSchema).optional(),
  summary: z.string().optional(),
  version: z.string().optional(),
  domainContext: DomainContextSchema.optional(),
  design: DesignPreferencesSchema.optional(),
  designTokens: DesignTokensSchema,
  customPatterns: CustomPatternMapSchema,
  orbitals: z
    .array(OrbitalZodSchema)
    .min(1, "At least one orbital is required"),
  locales: z.array(z.string().min(1)).optional(),
  publicDir: z.string().min(1).optional(),
  store: z.string().min(1).optional(),
  egress: z.array(z.string().min(1)).optional(),
  osGrants: OsGrantsSchema.optional(),
  deployment: DeploymentSchema.optional(),
  inbound: z.array(z.string().min(1)).optional(),
  site: SiteMetaSchema.optional(),
  lazyPages: z.array(LazyPageSchema).optional(),
  services: z.array(ServiceDefinitionSchema).optional(),
  config: DeclaredTraitConfigSchema.optional(),
  _metadata: SchemaMetadataSchema.optional(),
  // V4 identity — optional/dual-carry until the Phase-7 flip. Present on
  // id-carrying `.orb` files so `parseOrbitalSchema` preserves them instead
  // of stripping unknown keys.
  schemaVersion: z.number().optional(),
  ledger: IdentityLedgerSchema.optional(),
});

// ============================================================================
// Persisted/Flattened View
// ============================================================================

/**
 * Flattened `OrbitalSchema` view used by the persistence/runtime layer.
 *
 * Canonical `OrbitalSchema` keeps every trait inside its owning
 * `OrbitalDefinition.traits`. Some runtime paths (e.g. the orbital-agent
 * stream, Firestore persistence) additionally roll the resolved trait set up
 * to the top level as `traits[]` so diffs and list views don't have to walk
 * every orbital.
 *
 * This is intentionally a LOSSY persisted view, NOT the canonical authoring
 * shape: it carries the rolled-up array alongside the per-orbital trait
 * lists, and consumers should prefer `OrbitalSchema` whenever the rolled-up
 * surface isn't required.
 */
export interface OrbitalSchemaWithTraits extends OrbitalSchema {
  /** Flattened trait set rolled up from all orbitals. Persisted-view only. */
  traits?: Trait[];
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parses raw data into a validated OrbitalSchema.
 * 
 * Uses Zod validation to ensure the data conforms to the OrbitalSchema structure.
 * Throws a ZodError if validation fails. For safe parsing that doesn't throw,
 * use `safeParseOrbitalSchema()` instead.
 * 
 * @param {unknown} data - Raw data to parse (typically JSON)
 * @returns {OrbitalSchema} Validated orbital schema
 * @throws {z.ZodError} If data doesn't match OrbitalSchema structure
 * 
 * @example
 * ```typescript
 * try {
 *   const schema = parseOrbitalSchema(jsonData);
 *   console.log('Valid schema:', schema.name);
 * } catch (error) {
 *   console.error('Invalid schema:', error);
 * }
 * ```
 * 
 * @see safeParseOrbitalSchema
 */
export function parseOrbitalSchema(data: RuntimeValue): OrbitalSchema {
  return OrbitalSchemaSchema.parse(data);
}

/**
 * Safely parses raw data into a validated OrbitalSchema without throwing.
 * 
 * Uses Zod's safeParse method to validate data and return a result object
 * instead of throwing errors. This is useful for form validation and
 * user input handling where you want to gracefully handle invalid data.
 * 
 * @param {unknown} data - Raw data to parse (typically JSON)
 * @returns {z.SafeParseReturnType<OrbitalSchema, OrbitalSchema>} Parse result with success/status
 * 
 * @example
 * ```typescript
 * const result = safeParseOrbitalSchema(jsonData);
 * if (result.success) {
 *   console.log('Valid schema:', result.data.name);
 * } else {
 *   console.error('Validation errors:', result.error);
 * }
 * ```
 * 
 * @see parseOrbitalSchema
 */
export function safeParseOrbitalSchema(data: RuntimeValue) {
  return OrbitalSchemaSchema.safeParse(data);
}

// ============================================================================
// Type exports
// ============================================================================

export type OrbitalSchemaInput = z.input<typeof OrbitalSchemaSchema>;
