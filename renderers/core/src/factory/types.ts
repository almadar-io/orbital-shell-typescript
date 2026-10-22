import type { EntityPersistence } from '../types/entity.js';
import type { EntityField, RelationConfig } from '../types/field.js';
import type { TraitReference } from '../types/trait.js';
import type { TraitOverlayEntry } from './overlays.js';
import type { JsonValue } from '../types/json.js';
export type { EntityPersistence };
export type { JsonValue };

// ============================================================================
// JSON Schema (minimal subset — covers what the signature → schema generator
// emits + what OpenAI's strict-mode tool calling consumes).
// ============================================================================
//
// `JsonValue` (re-exported above) lives in `src/types/json.ts`. The
// canonical shape is mutable; consumers that want immutability take
// `Readonly<JsonValue>` at their boundary. Used by `JsonSchema.default`
// (arbitrary JSON literal) and any other JSON-shaped field.

/**
 * Recursive JSON Schema. Intentionally narrow — only the keywords V2's
 * signature → schema generator emits. Custom `x-*` extensions carry
 * descriptive metadata (synonyms, label) that doesn't shape validation
 * but stays in the schema for prompt rendering / studio UIs.
 */
export interface JsonSchema {
  $id?: string;
  minItems?: number;
  minProperties?: number;
  type?: JsonSchemaType | ReadonlyArray<JsonSchemaType>;
  description?: string;
  properties?: Readonly<{ [key: string]: JsonSchema }>;
  required?: ReadonlyArray<string>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: ReadonlyArray<string | number | boolean>;
  /** Single-value pin — JSON Schema 2020-12 `const` (an `enum` of one). */
  const?: string | number | boolean;
  oneOf?: ReadonlyArray<JsonSchema>;
  anyOf?: ReadonlyArray<JsonSchema>;
  allOf?: ReadonlyArray<JsonSchema>;
  /** Conditional subschemas — JSON Schema 2020-12 `if`/`then`/`else`. Used
   *  e.g. to pin `orbitalName` to an organism's exact roster per anchored
   *  organism (rabit set_roster, SCAN-ROSTER-RETRY-1). */
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
  default?: JsonValue;
  /**
   * Reference to a shared definition under `$defs` at the schema root.
   * Lets consumers DRY large repeated subschemas (e.g. a 300-entry enum
   * of std-behavior paths reused across every orbital branch of a tool
   * schema). Per JSON Schema 2020-12: absolute reference starting with
   * `#`. Standard OpenAI / DeepSeek strict-mode tool calling resolves
   * `$ref` against `$defs` defined on the tool's parameters root.
   */
  $ref?: string;
  /**
   * Inline subschema definitions referenced from elsewhere via `$ref`.
   * Lives at the schema root so all `$ref` paths can resolve. Values are
   * full `JsonSchema` (can be referenced recursively).
   */
  $defs?: Readonly<{ [key: string]: JsonSchema }>;
  /** Knob's `@synonyms` from the source `.lolo`. */
  'x-synonyms'?: string;
  /** Knob's `@label` from the source `.lolo`. */
  'x-label'?: string;
  /** Knob's `@tier` from the source `.lolo` (`domain`/`presentation`/`internal`). */
  'x-tier'?: string;
  /** Prompt-facing role hint for an `event`-typed knob wired in a DEFINER
   *  position (A-UNIFY) — its value CREATES the event name rather than
   *  referencing one, so it deliberately carries no enum pin. */
  'x-role'?: 'definer';
}

export type JsonSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

/**
 * OrbitalSchema field type tags. The factory-signature extractor lifts
 * these directly from the resolved `.orb`; consumers narrow further at
 * dispatch time.
 */
export type SchemaFieldType =
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
  | 'array'
  | 'object'
  | 'enum'
  | 'relation'
  | 'node'
  | 'event';

export interface FactorySignatureEntityField {
  name: string;
  type: SchemaFieldType;
  required: boolean;
  /** Runtime-managed widget state (`@intrinsic`). A composer must NOT remap an
   *  intrinsic slot onto a domain field — it rides along via `extends`. */
  intrinsic?: boolean;
  /** Human/semantic description (`@description "..."`). Slot-side signal for the
   *  curation field matcher + catalog search. */
  description?: string;
  /** User-vocabulary synonyms (`@synonyms "..."`). */
  synonyms?: string;
  /** Closed string vocabulary for `type: 'enum'` fields. Matches `EnumEntityField.values`. */
  values?: string[];
  /** Relation target binding for `type: 'relation'` fields. Matches `RelationEntityField.relation`. */
  relation?: RelationConfig;
}

/**
 * The canonical entity a factory produces. Almost always one entity
 * per orbital; modeled as an array to keep the door open for orbitals
 * that compose multiple entities.
 */
export interface FactoryEntitySignature {
  /** Canonical entity name the factory's params build (e.g. `"ChatMessage"`). */
  name: string;
  /** Fields the factory emits, post-auto-field stripping. */
  fields: ReadonlyArray<FactorySignatureEntityField>;
  /** Persistence mode declared on the canonical entity in the `.orb`. */
  persistence: EntityPersistence;
  /** The orbital's own traits fetch or persist this record, so a runtime one may still be saved. */
  dataBearing?: boolean;
}

/**
 * One overridable config knob a trait advertises. Lifted directly from
 * the source `.lolo` `config { }` block (which carries typed
 * declarations + defaults). Consumers (the questionnaire generator,
 * the studio) pick a widget from `type` and pre-fill from `default`.
 */
export interface FactoryConfigParam {
  /** Key name as advertised by the trait. Matches the override path
   *  `traitOverrides.<traitName>.config.<key>`. */
  key: string;
  /** True when the atom's own state machine consumes this config value in
   *  an entity position (`['persist', op, '@config.<key>', …]` or
   *  `['fetch', '@config.<key>', …]`) — the value IS an entity name.
   *  Source-derived at signature extraction, never authored. Consumers
   *  threading a `params.entityName` rename must rewrite every
   *  entityRef-marked value equal to the renamed entity, or the baked
   *  default dangles against an entity that no longer exists. */
  entityRef?: boolean;
  /** Type tag lifted from the `.lolo` config declaration. Drives the
   *  question widget selection. Free-form to admit array/object
   *  brackets (`[object]`, `[string]`) and atom-defined custom tags. */
  type: string;
  /** Canonical default value the factory uses when no override is
   *  supplied. Pre-fills the form widget so users see what they're
   *  about to change. */
  default?: FactoryParamValue;
  /** Human-friendly question prompt, lifted verbatim from the source
   *  `.lolo` `@label "..."` annotation. Contract: `@label` IS the
   *  rendered string — the questionnaire never manipulates it (no
   *  appended punctuation, no humanization, no fallback logic layered
   *  on top of an authored value). Undefined only when the atom author
   *  did not tag the knob; `buildConfigKeyQuestion` then falls back to
   *  `humanizeKey(key)` as a type guard, not user-facing inference — a
   *  domain-tier knob reaching that fallback is a source defect. */
  label?: string;
  /** Optional help-text. Lifted from `.lolo` `@description "..."`. */
  description?: string;
  /** Optional closed-enum value set. Lifted from `.lolo` enum syntax. */
  enumValues?: ReadonlyArray<string>;
  /** Array element schema when the slot's type is `[T]`. Mirrors the
   *  `.orb` `ConfigField.items` carrier (`FieldDefinition`-shaped). Lets
   *  consumers see the per-element typing — e.g. `metrics : [MetricSpec]`
   *  exposes `items.properties` with every MetricSpec field + its own
   *  `values: [...]` enum constraints. */
  items?: EntityField;
  /** Object property schemas keyed by property name when the slot's type
   *  is an inline `{ ... }` or a named struct alias. Mirrors the `.orb`
   *  `ConfigField.properties` carrier. */
  properties?: Readonly<Record<string, EntityField>>;
  /** Comma-separated user-vocabulary synonyms. Authored in `.lolo` as
   *  `@synonyms "..."` next to the knob declaration. Used by the agent's
   *  catalog-summary prompt (so the LLM connects user phrases to knob
   *  names) and by the publish-time knob-embeddings bake (so cosine
   *  narrowing recalls knobs voiced via synonym).
   *
   *  Example for the `height` knob on `std-graphs`:
   *    `@synonyms "taller, shorter, vertical size, pixel height"`
   *
   *  Stays a single free-form string; consumers decide their own
   *  splitting/formatting policy. */
  synonyms?: string;
  /** Decision-kind tier authored in `.lolo` as `@tier "..."` next to the
   *  knob declaration. Drives the studio Questionnaire's filter +
   *  disclosure: `internal` knobs are hidden entirely, `presentation`
   *  knobs collapse under the "Polish wording" panel, `domain` knobs
   *  render inline. Untagged knobs are treated as `presentation` by the
   *  studio (safe default — most un-audited knobs are presentation polish). */
  tier?: FactoryConfigTier;
}

/**
 * Decision-kind tier for a `FactoryConfigParam`. Source-tagged via the
 * `@tier "..."` annotation in `.lolo` — no heuristic inference on the
 * consumer side. Missing tag = author did not tag = treat as
 * `presentation` at render time.
 *
 *  - `domain` — configures THIS entity's business meaning (currency,
 *    SLA hours, which fields matter). The user MUST own these.
 *  - `policy` — turns on a cross-cutting GOVERNANCE behavior that changes
 *    what gets generated (audit trail, row access, approval gate, GDPR
 *    erasure, notification cadence). Shown by default alongside domain.
 *  - `infra` — wires a cross-cutting OPERATIONAL/structural primitive
 *    (lifecycle scans, deadline reminders, cascade-delete, N:M joins).
 *    Shown by default; mostly wiring rather than business choices.
 *  - `presentation` — changes how the same business meaning is RENDERED
 *    (labels, placeholders, titles, copy, column lists, action lists,
 *    layout fidelity like cols/gap/chartType). LLM picks defaults;
 *    user can edit post-generation.
 *  - `internal` — framework primitives (trait/slot/pattern types,
 *    *Event keys, layoutMode); the studio never surfaces these.
 */
export type FactoryConfigTier =
  | 'domain'
  | 'policy'
  | 'infra'
  | 'presentation'
  | 'internal';

/**
 * One trait the factory composes into the orbital. The projector reads
 * these to determine which factory's trait stack covers a given
 * orbital + which override knobs a presentation overlay can target.
 */
export interface FactoryTraitSignature {
  /** Canonical trait name post-rename (e.g. `"ChatMessageList"`). */
  name: string;
  /** Upstream trait reference path when this trait is a call-site override
   *  of an imported atom — e.g. `"Stats.traits.StatsItemStats"`. Absent
   *  when the trait is inline-defined (atom-tier traits). The catalog
   *  inheritance pass uses this to resolve the upstream atom signature
   *  so each call-site `overridableConfigKeys` entry gets `type` /
   *  `items` / `properties` filled in from the canonical declaration. */
  ref?: string;
  /** Set when the trait arrives through an orbital import
   *  (`orbital X = A.orbitals.Y { … }`): the import's upstream orbital path. The trait is part of
   *  what the orbital carries, but the import form cannot override it at the call site. */
  importedFrom?: string;
  /** Event keys this trait emits (post-rename). */
  emittedEvents: ReadonlyArray<string>;
  /** Event keys this trait listens for. */
  listenedEvents: ReadonlyArray<string>;
  /** Event keys the trait's own state machine transitions on
   *  (`stateMachine.transitions[].event`, post-rename) — the only valid
   *  `listens[].triggers` targets (ORB_X_LISTEN_TRIGGER_UNMATCHED
   *  otherwise). Present when the source trait carries a state machine
   *  (directly or inherited from its upstream atom); an EMPTY array means
   *  the trait is render-only and cannot accept a listens entry at all.
   *  Absent = topology unknown (legacy catalogs). */
  transitionEvents?: ReadonlyArray<string>;
  /** Call-site `events` rename map (old → new) authored on the trait ref.
   *  Renames rewrite the upstream atom's transition triggers, so catalog
   *  inheritance projects the atom's `transitionEvents` through this map
   *  before stamping them on the call site. */
  eventRenames?: Readonly<Record<string, string>>;
  /** Structured emit + listen events with their `@description`/`@synonyms`/`@tier`
   *  annotations. Parallel to `emittedEvents`/`listenedEvents` (kept as bare-key
   *  back-compat); the curation event matcher reads this. */
  events?: ReadonlyArray<FactoryEventSignature>;
  /** Config knobs overridable via `traitOverrides.<name>.config.<key>`.
   *  Each entry carries the key name plus the typed declaration lifted
   *  from the source `.lolo` `config { }` block. */
  overridableConfigKeys: ReadonlyArray<FactoryConfigParam>;
  /**
   * WIRE FORMAT ONLY — indices into `FactorySignatureCatalog.knobDefs`.
   *
   * Measured on the io catalog: 113,848 knob instances but only 16,067
   * DISTINCT ones (the same `align` knob is written out once per Typography
   * trait), so 26.2 MB — 66.3% of the catalog — was byte-identical
   * duplication. When a catalog carries `knobDefs`, each trait serialises
   * these refs INSTEAD of `overridableConfigKeys`, and the loader rehydrates
   * the field from the table before any consumer sees the signature.
   *
   * So this is absent in memory and `overridableConfigKeys` is always
   * populated — no consumer reads this. Rehydration substitutes SHARED
   * references, which is why it cuts heap and not merely disk.
   */
  overridableConfigKeyRefs?: ReadonlyArray<number>;
  /** Capability tags lifted directly from the source `.lolo` trait's
   *  header annotations. Free-form strings — the translator overlay
   *  matches rules to traits by exact set membership. */
  capabilities: ReadonlyArray<string>;
  /** The entity this trait is bound to at THIS call site — the `.orb`
   *  `TraitReference.linkedEntity` / inline `Trait.linkedEntity` (the same
   *  field a `traitOverrides.<name>.linkedEntity` rebind ultimately writes).
   *  Absent for a bare string ref, whose binding lives on the referenced
   *  atom's own signature entry in the same catalog. Read directly off the
   *  trait node — no inference. */
  linkedEntity?: string;
  /** `true` when the source trait's entity binding was authored
   *  `-> @rebindable Entity`. Only then may a consumer rebind it via
   *  `traitOverrides.<name>.linkedEntity`; rabit enum-constrains that
   *  override to the organism's entities and the validator enforces the
   *  field contract. Absent/false = fixed binding. */
  entityRebindable?: boolean;
  /** Inferred field contract a rebind target must satisfy. `requires` =
   *  fields the trait reads via `@entity.X`; `provides` = fields it writes.
   *  Present only alongside `entityRebindable`. */
  entityContract?: { requires: ReadonlyArray<string>; provides: ReadonlyArray<string> };
  /** Inferred effect surface — every effect the trait produces, with its
   *  resource and whether it sits in a transition or a `ticks` block. Answers
   *  "what does composing this trait bring along?" without reading the atom.
   *  Absent on traits that produce no effects. */
  effectRow?: ReadonlyArray<{
    kind: string;
    resource?: string;
    resolved?: boolean;
    site?: 'transition' | 'tick';
  }>;
  /** `@description` / `@synonyms` authored on the `@rebindable` binding —
   *  fed to catalog prose + knob-embeddings for binding-discovery. */
  entityBindingDescription?: string;
  entityBindingSynonyms?: string;
  /** Entity names this trait's state-machine effects reference
   *  (`stateMachine.transitions[].effects[]` — `persist create/update/delete`
   *  and `fetch`), deduplicated. Distinct from `linkedEntity` (the trait's
   *  OWN binding): this is every OTHER entity an effect reads or writes,
   *  e.g. `CheckoutWizard`'s `persist create OrderRecord` names
   *  `'OrderRecord'` here even though the trait itself is bound to
   *  `Checkout`. `subset_closure` (`packages/almadar-rabit`) uses this to
   *  detect a roster subset that would otherwise dangle a persist-effect
   *  reference the relation-field/`linkedEntity` walk alone can't see —
   *  measured cause of `ORB_EFF_FETCH_INVALID_ENTITY` on a scoped roster
   *  (`docs/Almadar_Studio_Failures_2026-08-04.md` §N). Absent = topology
   *  unknown (legacy catalogs), same convention as `transitionEvents`. */
  effectEntityRefs?: ReadonlyArray<string>;
  /** Config knobs wired in a DEFINER position — named by `emits { @config.<k> }`,
   *  a stateMachine `events[].key` sentinel, or a transition `event` sentinel
   *  (A-UNIFY; mirrors the Rust `trait_event_ctx`/`definer_knobs_for_trait`
   *  rule, declaration positions only, no cross-trait resolution). A
   *  DEFINER knob's value CREATES the event name rather than referencing an
   *  existing one, so the fill-schema enum pin (`schema.ts` `knobToSchema`)
   *  skips it — any name is valid by construction, it cannot go stale.
   *  Source-derived, never authored; absent = topology unknown (legacy
   *  catalogs), same convention as `transitionEvents`. */
  definerKnobs?: ReadonlyArray<string>;
}

/** One event a trait emits or listens for, with its authored annotations — the
 *  per-event analogue of `FactorySignatureEntityField` / `FactoryConfigParam`.
 *  Feeds the curation event matcher (embedding-wire a composed style atom's
 *  actions to a domain lifecycle's events). */
export interface FactoryEventSignature {
  /** Event key (post-rename). */
  name: string;
  /** Whether the trait emits the event or listens for it. */
  direction: 'emit' | 'listen';
  /** Authored `@description` on the emit/listen. */
  description?: string;
  /** Authored `@synonyms` (comma-separated user vocabulary). */
  synonyms?: string;
  /** Authoring `@tier` (`essential`/`customization`/`advanced`/`internal`). */
  tier?: string;
}

/** One page the factory emits. The path is the factory default; the
 *  projector may override via `params.pagePaths`. */
export interface FactoryPageSignature {
  name: string;
  defaultPath: string;
  primaryEntity: string;
}

/**
 * Which coordinator surface may see this entry: `'app'` = pickable factory
 * organism catalog (the domain's admin/back-office organism), `'experience'` =
 * pickable as the user-facing product of a domain (composes the same atoms as
 * its `'app'` organism; design and flow only), `'palette'` = free-lolo compose
 * palette, `'both'`, `'internal'` = neither.
 */
export type FactoryExposure = 'app' | 'experience' | 'palette' | 'both' | 'internal';

/**
 * `'generated'` = machine-emitted 1:1 wrapper (lolo-ui), `'authored'` =
 * hand-authored (`.hand-authored.json` membership), `'promoted'` = landed
 * through the cache-fill promotion pipeline.
 */
export type FactoryProvenance = 'generated' | 'authored' | 'promoted';

export interface FactorySignature {
  /** Organism the factory belongs to (e.g. `"std-realtime-chat"`). */
  organism: string;
  /** Orbital this factory builds within that organism. */
  orbital: string;
  /** Tier the factory sits in (informational). */
  tier: 'atoms' | 'molecules' | 'organisms';
  /** Path of the generated factory source (relative to the std root). */
  factoryPath: string;
  /** Canonical entity surface(s) the factory produces. */
  entities: ReadonlyArray<FactoryEntitySignature>;
  /** Trait stack the factory composes. */
  traits: ReadonlyArray<FactoryTraitSignature>;
  /** Pages the factory emits. */
  pages: ReadonlyArray<FactoryPageSignature>;
  /** Union of all `traits[].emittedEvents`. */
  emittedEvents: ReadonlyArray<string>;
  /** Union of all `traits[].listenedEvents`. */
  listenedEvents: ReadonlyArray<string>;
  /**
   * This orbital's OWN declared knobs (`Orbital.config`) — distinct from
   * `traits[].overridableConfigKeys`, which are per-TRAIT. Same shape and
   * semantics as a trait's config surface: type/default/label/description/
   * synonyms/tier lifted from the source `.lolo` `config { }` block
   * authored directly on the orbital. Omitted when the orbital declares no
   * config of its own.
   */
  config?: ReadonlyArray<FactoryConfigParam>;
  /**
   * WIRE FORMAT ONLY — indices into `FactorySignatureCatalog.knobDefs`, the
   * orbital-config sibling of `FactoryTraitSignature.overridableConfigKeyRefs`.
   * Absent in memory — `config` is always populated instead; `rehydrateKnobDefs`
   * substitutes it from this table before any consumer sees the signature.
   */
  configRefs?: ReadonlyArray<number>;
  /**
   * JSON Schema for the orbital's `AnalysisOrbitalParams` shape. Walks
   * `traitOverrides.<TraitName>.config.<knob>` with the exact type
   * (string/number/boolean/array/object) lifted from each knob's
   * declaration, `enum` from `enumValues`, recursive `items` for array
   * slots, recursive `properties` for struct slots. Every level carries
   * `additionalProperties: false` so the LLM cannot emit unknown trait
   * names, invented knob keys, or out-of-set enum values.
   *
   * Pre-computed at signature extraction time by
   * `tools/almadar-pattern-sync/src/std-ts/signatures/`. V2 tool-calling
   * (`@almadar-io/agent`'s coordinator + per-orbital subagent) feeds this
   * directly to OpenAI's `tool.parameters` with `strict: true` — the
   * LLM is physically constrained by the schema instead of relying on
   * post-hoc validation.
   *
   * Optional for backward compatibility: signatures emitted by older
   * pattern-sync versions don't carry it, in which case V2 tools fall
   * back to a loose schema + post-hoc validation.
   */
  paramsSchema?: JsonSchema;
  /**
   * Which coordinator surface may see this entry: `'app'` = pickable
   * factory organism catalog, `'palette'` = free-lolo compose palette,
   * `'both'`, `'internal'` = neither. Stamped at generation time by
   * `tools/almadar-pattern-sync` (std-ts) from the `.lolo` `@exposure`
   * header tag with per-topic defaults; consumers treat a missing field
   * as "pre-V3 signature" and fall back to their legacy filters. An
   * entry may carry `'app'`/`'both'` only if its factory is registered
   * in the package's dispatch registry — enforced at generation time.
   */
  exposure?: FactoryExposure;
  /**
   * `'generated'` = machine-emitted 1:1 wrapper (lolo-ui), `'authored'` =
   * hand-authored (`.hand-authored.json` membership), `'promoted'` =
   * landed through the cache-fill promotion pipeline.
   */
  provenance?: FactoryProvenance;
  /**
   * Deterministic hash of the ui-substrate surface the behavior composes,
   * stamped for `authored`/`promoted` (blessed) entries: sha256 (16 hex
   * chars) over the sorted union of the registry .orb's `uses[].from`
   * basenames and each trait `ref`'s imported trait name. A substrate
   * change (what the entry composes) flips it — drift against the current
   * substrate flags the entry for review. Stamped by pattern-sync std-ts
   * (`computeSubstrateSignature`); recomputed every generation run.
   */
  substrateSignature?: string;
  /**
   * Organism-only dispatch smoke test. Stamped by pattern-sync gen-ts;
   * `true` when the organism's factory dispatch with default params
   * round-trips `orb resolve` clean. `false` = not factory ready (excluded
   * from HIT retrieval; stays compose-palette if palette-exposed).
   * Undefined = not yet swept (legacy catalogs).
   */
  factoryReady?: boolean;
  /** Resolve/validate error strings when `factoryReady` is `false`. */
  readinessErrors?: ReadonlyArray<string>;
  /**
   * Tier-agnostic (atoms/molecules/organisms alike). Stamped by
   * pattern-sync gen-ts for every behavior entry: `true` when the
   * registry `.orb` passes `orb validate` + `orb resolve` at bake time.
   * `false` = source-broken (excluded from retrieval regardless of tier).
   * Undefined = not yet swept (legacy catalogs). Distinct from
   * `factoryReady`, which additionally requires an organism-level
   * dispatch smoke test.
   */
  sourceValid?: boolean;
  /** `orb validate`/`orb resolve` error strings when `sourceValid` is `false`. */
  sourceErrors?: ReadonlyArray<string>;
}

/**
 * A package's extracted signatures. No file carries it since 2026-10-14. Sorted by organism then orbital.
 */
export interface FactorySignatureCatalog {
  /** Generated-by version stamp (the `@almadar/std` minor it shipped in). */
  generatedFromStdVersion: string;
  /** Sorted list of factory signatures. */
  signatures: ReadonlyArray<FactorySignature>;
  /**
   * Built-in theme keys harvested from `@almadar-ui/themes/*.css`, carried
   * ONCE for the whole catalog rather than per signature.
   *
   * `signatureToParamsSchema` needs them for the `theme` enum but lives here
   * in core, which is UPSTREAM of `@almadar/ui` and so cannot read the CSS
   * itself — the harvester injects them. Catalog-level because the list is
   * a property of the build, not of any one orbital: every signature's
   * `theme` enum was already identical, which is exactly why rabit's
   * `catalogThemeNames` could take "the first hit is canonical" as its rule.
   *
   * Optional so a catalog written before this field still loads; consumers
   * degrade to no theme enum (no constraint) rather than failing.
   */
  themeNames?: ReadonlyArray<string>;
  /**
   * Deduplicated knob table. Each trait's `overridableConfigKeyRefs` indexes
   * into this; the loader rehydrates `overridableConfigKeys` from it, sharing
   * one object per distinct knob across every trait that declares it.
   *
   * Absent on catalogs written before dedupe, in which case traits carry
   * their `overridableConfigKeys` inline as before and no rehydration runs.
   */
  knobDefs?: ReadonlyArray<FactoryConfigParam>;
}


/**
 * A single factory invocation, as the typed result of the translator.
 * Lower into runtime by calling the factory at `factoryPath` with
 * these `params`. Stable identity for downstream diffing is
 * `(organism, orbital)`.
 */
export interface FactoryCallSite {
  organism: string;
  /** The catalog orbital the factory builds (signature key). */
  orbital: string;
  /**
   * The plan's own name for this orbital when it differs from `orbital` — a
   * line built from a catalog orbital under the user's name. Questions and
   * the answers that mutate the plan key on it; absent ⇒ `orbital`.
   */
  orbitalName?: string;
  factoryPath: string;
  params: FactoryCallSiteParams;
}

/**
 * The typed param surface every factory's call site populates. Each
 * field corresponds to one row in the translator's overlay → factory
 * mapping table.
 */
export interface FactoryCallSiteParams {
  /** Override `signature.entities[0].name` (entity rename). */
  entityName?: string;
  /** Additional or overriding entity fields. Caller wins on collision. */
  entityFields?: ReadonlyArray<EntityField>;
  /** Override `signature.entities[0].persistence`. */
  persistence?: EntityPersistence;
  /** Override the entity's storage collection key. */
  collection?: string;
  /** Per-page path overrides keyed by `signature.pages[i].name`. */
  pagePaths?: Readonly<Record<string, string>>;
  /**
   * Theme name (a `data-theme` key from the built-in `@almadar-ui/themes/`
   * registry) stamped onto `Orbital.theme` post-factory. Plan-level and
   * uniform — the coordinator decides it once and threads the same value
   * to every orbital; the per-orbital subagent does not independently pick.
   * Applied post-`dispatchOrbitalFactoryMerged` via `applyOrbitalTheme`,
   * exactly as `pagePaths`/`pages` are applied post-factory, so the factory's
   * typed guard never sees it.
   */
  theme?: string;
  /** Trait-level overrides keyed by `signature.traits[i].name`. Each value
   *  is a {@link TraitOverlayEntry} — the canonical override surface that
   *  admits the full documented set (`config`, `linkedEntity`, `events`,
   *  `name`, `emitsScope`, `listens`) and mirrors what `TraitOverlay` (the
   *  LLM-facing input) and {@link MakeTraitRefOpts} (the builder input)
   *  both accept. The translator threads each field from the overlay
   *  through to here verbatim; the factory applies them via the same
   *  `TraitReference` override semantics the inliner uses on hand-authored
   *  `.orb` traits. Pre-unification this carried only `{ config? }`, which
   *  silently dropped every other override field even though both the
   *  overlay layer above and the factory builders below accepted them. */
  traitOverrides?: Readonly<Record<string, TraitOverlayEntry>>;
  /** Extra traits to compose into the orbital that aren't part of the
   *  canonical signature trait stack. */
  extraTraits?: ReadonlyArray<TraitReference>;
}

/**
 * Allowed leaf values for the typed factory-param surface.
 */
export type FactoryParamValue =
  | string
  | number
  | boolean
  | ReadonlyArray<FactoryParamValue>
  | { readonly [key: string]: FactoryParamValue };
