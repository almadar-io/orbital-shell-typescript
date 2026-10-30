/**
 * Behaviors as first-class values (language trio, `docs/Almadar_Studio_Behavior.md`).
 *
 * A trait value names a trait of an installed behavior package and carries the
 * call-site overrides of the trait-reference form (LOLO §8); an orbital value
 * names an orbital and carries the orbital-import body (LOLO §8b). Their literal
 * spellings mirror those forms with the `uses` specifier in the alias position:
 * `std/std-kanban.traits.KanbanBoard`, `std/std-kanban.orbitals.KanbanOrbital`.
 * orbital-core's `schema::behavior_value` is the Rust twin.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { DeclaredTraitConfigSchema, TraitConfigValueSchema, TraitReferenceObjectSchema, type TraitConfigValue, type TraitReference } from './trait.js';
import { ExpectDeclarationSchema, OrbitalRefObjectSchema, type OrbitalRefObject } from './orbital.js';
import { EntityFieldSchema, type EntityField } from './field.js';
import { EntityPersistenceSchema } from './entity.js';
import { StateMachineSchema, type StateMachine } from './state-machine.js';
import type { JsonValue, RuntimeValue } from './json.js';
import type { OrbitalSchema } from './schema.js';
import type { FactoryExposure } from '../factory/types.js';

/** The §8 call-site override surface a trait value records (`behavior/apply`). */
export type TraitOverrides = Pick<TraitReference, 'config' | 'events' | 'fields' | 'listens' | 'emitsScope' | 'linkedEntity'>;

/** A trait of an installed behavior, plus the overrides applied to it. */
export type TraitValue = TraitOverrides & {
  /** The behavior's specifier: canonical `<prefix>/<name>` (the compiler and `behavior/catalog` emit it), `std/behaviors/<name>` as authored, or workspace-relative `./orbitals/<name>` (what `program/eval` wrote). */
  readonly behavior: string;
  /** The trait's upstream name. */
  readonly trait: string;
};

const TRAITS_SEGMENT = '.traits.';
const ORBITALS_SEGMENT = '.orbitals.';
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
// `<prefix>/<name>` (canonical), the `uses` std spelling `std/behaviors/<name>`, or a
// workspace-relative `./<dir>/<name>` (a program `program/eval` wrote, default `./orbitals/`).
const SPECIFIER = /^(?:[a-z0-9][a-z0-9-]*(?:\/behaviors)?|\.(?:\/[A-Za-z0-9_-]+)+)\/[A-Za-z0-9][A-Za-z0-9_-]*$/;

function splitLiteral(raw: string, segment: string): { behavior: string; name: string } | undefined {
  const at = raw.lastIndexOf(segment);
  if (at <= 0) return undefined;
  const behavior = raw.slice(0, at);
  const name = raw.slice(at + segment.length);
  if (!SPECIFIER.test(behavior) || !PASCAL.test(name)) return undefined;
  return { behavior, name };
}

/** Parse `<prefix>/<name>.traits.<Trait>`; undefined for anything else (a local `@trait.X` included). */
export function parseTraitValueLiteral(raw: string): TraitValue | undefined {
  const parts = splitLiteral(raw, TRAITS_SEGMENT);
  return parts === undefined ? undefined : { behavior: parts.behavior, trait: parts.name };
}

/** Parse `<prefix>/<name>.orbitals.<Orbital>`; undefined for anything else. */
export function parseOrbitalValueLiteral(raw: string): OrbitalValue | undefined {
  const parts = splitLiteral(raw, ORBITALS_SEGMENT);
  return parts === undefined ? undefined : { behavior: parts.behavior, orbital: parts.name };
}

/** Parse either literal form. */
export function parseBehaviorValueLiteral(raw: string): BehaviorValue | undefined {
  return parseTraitValueLiteral(raw) ?? parseOrbitalValueLiteral(raw);
}

/** Inverse of {@link parseTraitValueLiteral}; drops overrides (they have no literal form). */
export function formatTraitValueLiteral(value: Pick<TraitValue, 'behavior' | 'trait'>): string {
  return `${value.behavior}${TRAITS_SEGMENT}${value.trait}`;
}

/** Inverse of {@link parseOrbitalValueLiteral}; drops the recorded import body. */
export function formatOrbitalValueLiteral(value: Pick<OrbitalValue, 'behavior' | 'orbital'>): string {
  return `${value.behavior}${ORBITALS_SEGMENT}${value.orbital}`;
}

/** Either literal form, by kind. */
export function formatBehaviorValueLiteral(value: BehaviorValue): string {
  return isOrbitalValueShape(value) ? formatOrbitalValueLiteral(value) : formatTraitValueLiteral(value);
}

/** Validates the §8 override object `behavior/apply` takes; unknown keys are rejected. */
export const TraitOverridesSchema = TraitReferenceObjectSchema.pick({
  config: true,
  events: true,
  fields: true,
  listens: true,
  emitsScope: true,
  linkedEntity: true,
}).strict();

/** Validates a trait value carried as data: identity plus the recorded overrides. */
export const TraitValueSchema = TraitOverridesSchema.extend({
  behavior: z.string().regex(SPECIFIER),
  trait: z.string().regex(PASCAL),
}).strict();

/**
 * The §8b import body an orbital value records. Config holds plain values, as at
 * a trait call site; the import builder wraps them into the IR's declaration form.
 * `name` is the orbital's name in the importing program (default: the upstream name).
 */
export type OrbitalOverrides = Omit<OrbitalRefObject, 'ref' | 'refId' | 'config' | 'traits'> & {
  readonly name?: string;
  /** The source behavior's app-level knobs (its top-level `config {}`), as `uses Source { config }` sets them. */
  readonly app?: Readonly<Record<string, TraitConfigValue>>;
  readonly config?: Readonly<Record<string, TraitConfigValue>>;
  readonly traits?: Readonly<Record<string, TraitOverrides>>;
  /** Imports the value's sibling traits compose from, beside its own source. */
  readonly uses?: readonly OrbitalValueUse[];
  /** Traits the import orbital declares beside the imported ones, mountable through `mounts`. */
  readonly siblings?: readonly OrbitalValueSibling[];
};

/** An orbital of an installed behavior, plus the import body applied to it. */
export type OrbitalValue = OrbitalOverrides & {
  readonly behavior: string;
  /** The orbital's upstream name. */
  readonly orbital: string;
};

/** A trait value or an orbital value. */
export type BehaviorValue = TraitValue | OrbitalValue;

/** One import the value's own sibling traits compose from (`uses <as> from <from>` on the import orbital). */
export const OrbitalValueUseSchema = z.object({ from: z.string(), as: z.string().regex(PASCAL) }).strict();
export type OrbitalValueUse = z.infer<typeof OrbitalValueUseSchema>;

/** A trait the import orbital declares beside the imported ones (`trait <name> = <ref> { config }`), mountable through `mounts`. */
export const OrbitalValueSiblingSchema = z
  .object({
    name: z.string().regex(PASCAL),
    ref: z.string(),
    linkedEntity: z.string().optional(),
    config: z.record(z.string(), TraitConfigValueSchema).optional(),
  })
  .strict();
export type OrbitalValueSibling = z.infer<typeof OrbitalValueSiblingSchema>;

/** Validates the §8b body `behavior/apply` takes for an orbital value; unknown keys are rejected. */
export const OrbitalOverridesSchema = OrbitalRefObjectSchema.omit({ ref: true, refId: true, config: true, traits: true })
  .extend({
    name: z.string().regex(PASCAL).optional(),
    app: z.record(z.string(), TraitConfigValueSchema).optional(),
    config: z.record(z.string(), TraitConfigValueSchema).optional(),
    traits: z.record(z.string(), TraitOverridesSchema).optional(),
    uses: z.array(OrbitalValueUseSchema).optional(),
    siblings: z.array(OrbitalValueSiblingSchema).optional(),
  })
  .strict();

/** Validates an orbital value carried as data. */
export const OrbitalValueSchema = OrbitalOverridesSchema.extend({
  behavior: z.string().regex(SPECIFIER),
  orbital: z.string().regex(PASCAL),
}).strict();

/** Validates either kind. */
export const BehaviorValueSchema = z.union([TraitValueSchema, OrbitalValueSchema]);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function mergeTraitOverrides(base: TraitOverrides, overrides: TraitOverrides): TraitOverrides {
  const merged: Mutable<TraitOverrides> = { ...base };
  if (overrides.config !== undefined) merged.config = { ...base.config, ...overrides.config };
  if (overrides.events !== undefined) merged.events = { ...base.events, ...overrides.events };
  if (overrides.fields !== undefined) merged.fields = { ...base.fields, ...overrides.fields };
  if (overrides.listens !== undefined) merged.listens = overrides.listens;
  if (overrides.emitsScope !== undefined) merged.emitsScope = overrides.emitsScope;
  if (overrides.linkedEntity !== undefined) merged.linkedEntity = overrides.linkedEntity;
  return merged;
}

/**
 * `behavior/apply` on a trait value: `config`, `events` and `fields` merge
 * key-wise with the later value winning; `listens`, `emitsScope` and
 * `linkedEntity` replace. Pure — the input is not mutated.
 */
export function applyTraitOverrides(value: TraitValue, overrides: TraitOverrides): TraitValue {
  return { ...mergeTraitOverrides(value, overrides), behavior: value.behavior, trait: value.trait };
}

function mergeFieldsByName(base: readonly EntityField[] | undefined, next: readonly EntityField[]): EntityField[] {
  const out = [...(base ?? [])];
  for (const field of next) {
    const at = field.name === undefined ? -1 : out.findIndex((f) => f.name === field.name);
    if (at >= 0) out[at] = field;
    else out.push(field);
  }
  return out;
}

/**
 * `behavior/apply` on an orbital value — the §8b merge table. Maps
 * (`config`, `events`, `fields`, `pages`, `pageModifiers`, `roles`, `entities`,
 * `mounts`, `mock`) merge key-wise, later wins; `traits` merges per trait with the
 * trait-value rules; `extend` and `retype` merge by field name; everything else
 * (`name`, `entity`, `persistence`, `collection`, `only`, `omit`, `listens`, the
 * flags) replaces. Pure.
 */
export function applyOrbitalOverrides(value: OrbitalValue, overrides: OrbitalOverrides): OrbitalValue {
  const merged: Mutable<OrbitalValue> = { ...value, ...overrides, behavior: value.behavior, orbital: value.orbital };
  if (overrides.app !== undefined) merged.app = { ...value.app, ...overrides.app };
  if (overrides.config !== undefined) merged.config = { ...value.config, ...overrides.config };
  if (overrides.events !== undefined) merged.events = { ...value.events, ...overrides.events };
  if (overrides.fields !== undefined) merged.fields = { ...value.fields, ...overrides.fields };
  if (overrides.pages !== undefined) merged.pages = { ...value.pages, ...overrides.pages };
  if (overrides.pageModifiers !== undefined) merged.pageModifiers = { ...value.pageModifiers, ...overrides.pageModifiers };
  if (overrides.roles !== undefined) merged.roles = { ...value.roles, ...overrides.roles };
  if (overrides.entities !== undefined) merged.entities = { ...value.entities, ...overrides.entities };
  if (overrides.mounts !== undefined) merged.mounts = { ...value.mounts, ...overrides.mounts };
  if (overrides.mock !== undefined) merged.mock = { ...value.mock, ...overrides.mock };
  if (overrides.extend !== undefined) merged.extend = mergeFieldsByName(value.extend, overrides.extend);
  if (overrides.retype !== undefined) merged.retype = mergeFieldsByName(value.retype, overrides.retype);
  if (overrides.uses !== undefined) {
    const byAlias = new Map((value.uses ?? []).map((u) => [u.as, u]));
    for (const use of overrides.uses) byAlias.set(use.as, use);
    merged.uses = [...byAlias.values()];
  }
  if (overrides.siblings !== undefined) {
    const byName = new Map((value.siblings ?? []).map((t) => [t.name, t]));
    for (const sibling of overrides.siblings) {
      const prior = byName.get(sibling.name);
      byName.set(sibling.name, { ...prior, ...sibling, ...(prior?.config !== undefined || sibling.config !== undefined ? { config: { ...prior?.config, ...sibling.config } } : {}) });
    }
    merged.siblings = [...byName.values()];
  }
  if (overrides.traits !== undefined) {
    const traits: Record<string, TraitOverrides> = { ...value.traits };
    for (const [name, entry] of Object.entries(overrides.traits)) {
      traits[name] = mergeTraitOverrides(traits[name] ?? {}, entry);
    }
    merged.traits = traits;
  }
  return merged;
}

/** `behavior/apply` for either kind; the overrides are validated against the value's kind. */
export function applyBehaviorOverrides(value: BehaviorValue, overrides: JsonValue): BehaviorValue {
  if (isOrbitalValueShape(value)) return applyOrbitalOverrides(value, OrbitalOverridesSchema.parse(overrides));
  return applyTraitOverrides(value, TraitOverridesSchema.parse(overrides));
}

/** Structural guard for a trait value carried as data. */
export function isTraitValue(value: RuntimeValue): value is TraitValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('behavior' in value) || !('trait' in value)) return false;
  const { behavior, trait } = value;
  return typeof behavior === 'string' && SPECIFIER.test(behavior) && typeof trait === 'string' && PASCAL.test(trait);
}

/** Structural guard for an orbital value carried as data. */
export function isOrbitalValue(value: RuntimeValue): value is OrbitalValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('behavior' in value) || !('orbital' in value)) return false;
  const { behavior, orbital } = value;
  return typeof behavior === 'string' && SPECIFIER.test(behavior) && typeof orbital === 'string' && PASCAL.test(orbital);
}

/** A whole behavior as a value (`.lolo` type `behavior`): what `behavior/ref` builds and a render embed runs. */
export function behaviorRef(specifier: string): BehaviorRef {
  if (!SPECIFIER.test(specifier)) {
    throw new Error(`behavior/ref: "${specifier}" is not a behavior specifier (<prefix>/<name>, std/behaviors/<name> or ./<dir>/<name>)`);
  }
  return { behavior: specifier };
}

/** Structural guard for a behavior value: a specifier and, optionally, its declared bridge (a trait or orbital value names a member too). */
export function isBehaviorRefValue(value: RuntimeValue): value is BehaviorRef {
  return BehaviorRefSchema.safeParse(value).success;
}

function isOrbitalValueShape(value: BehaviorValue): value is OrbitalValue {
  return 'orbital' in value;
}

const EXPOSURES = ['app', 'experience', 'palette', 'both', 'internal'] as const satisfies readonly FactoryExposure[];
const VectorSchema = z.array(z.number());

/**
 * A `behavior/catalog` scope: registry folders `<prefix>/<topic>[/<tier>]` (the
 * tree packages ship as `<registry>/<topic>/<tier>/<name>.orb`), optionally
 * narrowed by exposure.
 */
export const CatalogScopeSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  exposure: z.array(z.enum(EXPOSURES)).optional(),
}).strict();
export type CatalogScope = z.infer<typeof CatalogScopeSchema>;

/**
 * The events an embedded behavior exchanges with the page that embeds it: `listens` are the
 * host's events delivered into it (to every trait that handles one), `emits` are its own
 * `external` events re-emitted on the host. Nothing else crosses; without a bridge it runs isolated.
 */
export const BehaviorBridgeSchema = z.object({
  listens: z.array(z.string().min(1)),
  emits: z.array(z.string().min(1)),
}).strict();
export type BehaviorBridge = z.infer<typeof BehaviorBridgeSchema>;

/**
 * A behavior named by itself, with no trait or orbital picked (what `behavior/describe` takes for a whole behavior), the
 * bridge its embed declares, if any, and optionally `resolved`: the behavior's resolved program as JSON, validated by
 * whoever set it, which an embed runs as it is instead of asking the host to mount the behavior.
 */
export const BehaviorRefSchema = z.object({ behavior: z.string().regex(SPECIFIER), bridge: BehaviorBridgeSchema.optional(), resolved: z.string().min(1).optional() }).strict();
export type BehaviorRef = z.infer<typeof BehaviorRefSchema>;

/** The overrides `behavior/apply` takes for a whole behavior value: its bridge. */
export const BehaviorRefOverridesSchema = z.object({ bridge: BehaviorBridgeSchema }).strict();

/** `behavior/apply` on a behavior value: records (replaces) its bridge. Pure. */
export function applyBehaviorRefOverrides(value: BehaviorRef, overrides: JsonValue): BehaviorRef {
  const parsed = BehaviorRefOverridesSchema.parse(overrides);
  return { behavior: value.behavior, bridge: parsed.bridge };
}

/** One behavior `behavior/catalog` returns (`orb behaviors catalog --json`). */
export const CatalogEntrySchema = z.object({
  /** `<prefix>/<name>`. */
  behavior: z.string(),
  package: z.string(),
  topic: z.string(),
  level: z.enum(['atom', 'molecule', 'organism']),
  exposure: z.enum(EXPOSURES).optional(),
  /** The `@almadar/ui` pattern the behavior is the factory of (`;; @pattern`); absent when it is not one. */
  pattern: z.string().optional(),
  description: z.string(),
  capabilities: z.array(z.string()),
  /** The behavior's traits as ready-to-bind values; absent in a listing asked for without traits (`traits: false`). */
  traits: z.array(TraitValueSchema).optional(),
  /** The behavior as a value (`.lolo` type `behavior`), ready to embed or store. */
  value: BehaviorRefSchema,
  /** Shipped embedding vectors, keyed by facet (`description`, `capabilities`). */
  vectors: z.record(z.string(), VectorSchema),
  /** The embedding model the vectors were stamped with. */
  model: z.string(),
}).strict();
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/** One knob of a described trait, with its shipped embedding vector. */
export type TraitKnob = {
  key: string;
  type: string;
  default?: TraitConfigValue;
  label?: string;
  description?: string;
  tier?: string;
  vector?: number[];
};
export const TraitKnobSchema: z.ZodType<TraitKnob> = z.object({
  key: z.string(),
  type: z.string(),
  default: TraitConfigValueSchema.optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  tier: z.string().optional(),
  vector: VectorSchema.optional(),
}).strict();

/** A described trait's events: what it emits, listens to and transitions on, and which of those its source declares `@tier "domain"`. */
export type TraitEvents = {
  emits: string[];
  listens: string[];
  /** Events the trait's own transitions fire on — the only valid `listens` triggers. */
  transitions: string[];
  domain?: string[];
};
export const TraitEventsSchema: z.ZodType<TraitEvents> = z.object({
  emits: z.array(z.string()),
  listens: z.array(z.string()),
  transitions: z.array(z.string()),
  domain: z.array(z.string()).optional(),
}).strict();

/** A described trait's state machine as the program runs it (resolved: composition and renames applied). */
export type TraitMachine = {
  linkedEntity?: string;
  stateMachine: StateMachine;
};
const TraitMachineObject = z.object({
  linkedEntity: z.string().optional(),
  stateMachine: StateMachineSchema,
}).strict();
export const TraitMachineSchema: z.ZodType<TraitMachine, z.input<typeof TraitMachineObject>> = TraitMachineObject;

/** A described trait printed as `.lolo` by orb's formatter, with the 1-based lines each transition (by its index in the machine) spans. */
export type TraitSource = {
  text: string;
  transitions: { index: number; start: number; end: number }[];
};
export const TraitSourceSchema: z.ZodType<TraitSource> = z.object({
  text: z.string(),
  transitions: z.array(z.object({ index: z.number().int(), start: z.number().int(), end: z.number().int() }).strict()),
}).strict();

/** What `behavior/describe` returns for a trait value (`orb behaviors describe --json`). */
export type TraitDescription = {
  value: TraitValue;
  knobs: TraitKnob[];
  events: TraitEvents;
  /** The trait's state machine; absent from an older orb. */
  machine?: TraitMachine;
  /** The trait as orb prints it; absent from an older orb. */
  source?: TraitSource;
  model: string;
};
const TraitDescriptionObject = z.object({
  value: TraitValueSchema,
  knobs: z.array(TraitKnobSchema),
  events: TraitEventsSchema,
  machine: TraitMachineSchema.optional(),
  source: TraitSourceSchema.optional(),
  model: z.string(),
}).strict();
export const TraitDescriptionSchema: z.ZodType<TraitDescription, z.input<typeof TraitDescriptionObject>> = TraitDescriptionObject;


/** What `behavior/describe` accepts: a trait value, an orbital value, or a whole behavior. */
export const DescribeTargetSchema = z.union([TraitValueSchema, OrbitalValueSchema, BehaviorRefSchema]);
export type DescribeTarget = TraitValue | OrbitalValue | BehaviorRef;

/** One knob as a payload field (`orb behaviors describe`): its struct and list shapes resolved, plus its declared docs. */
export interface KnobField {
  readonly name: string;
  readonly type: string;
  readonly required?: boolean;
  readonly values?: readonly string[];
  readonly properties?: readonly KnobField[];
  /** The knob's current value: what a caller keeps when it does not change it. */
  readonly default?: TraitConfigValue;
  readonly label?: string;
  readonly description?: string;
  readonly synonyms?: string;
  readonly tier?: string;
  /** The `@config.<knob>` this knob's value forwards: its text is owned (and set) there. */
  readonly forwardedFrom?: string;
}
export const KnobFieldSchema: z.ZodType<KnobField> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().optional(),
    values: z.array(z.string()).optional(),
    properties: z.array(KnobFieldSchema).optional(),
    default: TraitConfigValueSchema.optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    synonyms: z.string().optional(),
    tier: z.string().optional(),
    forwardedFrom: z.string().optional(),
  }).strict(),
);

/** One orbital of a described behavior, from its resolved program. */
export const OrbitalDescriptionSchema = z.object({
  value: OrbitalValueSchema,
  config: DeclaredTraitConfigSchema,
  knobs: z.array(KnobFieldSchema),
  entity: z.object({ name: z.string(), fields: z.array(EntityFieldSchema), identity: z.boolean().optional(), persistence: EntityPersistenceSchema.optional() }).strict().optional(),
  /** Entities a sibling orbital owns that this one references: what an import of it maps through `entities {}`. */
  borrows: z.array(z.string()),
  /** What the orbital needs from its siblings at runtime, derived by `orb` (identity, entities, pages, events). */
  expects: z.array(ExpectDeclarationSchema),
  traits: z.array(z.object({
    trait: z.string(),
    config: DeclaredTraitConfigSchema,
    knobs: z.array(KnobFieldSchema),
    events: TraitEventsSchema,
    /** Declared `-> @rebindable`: the trait may be bound to another record. */
    rebindable: z.boolean().optional(),
    /** The upstream trait this one composes (`trait X = Alias.traits.Y`), as written; absent for a trait the behavior defines itself. */
    ref: z.string().optional(),
    /** The trait's declared `@capabilities` tags. */
    capabilities: z.array(z.string()).optional(),
  }).strict()),
  /** Each page with the traits it mounts: what the behavior declares as standing on its own. */
  pages: z.array(z.object({ name: z.string(), path: z.string(), traits: z.array(z.string()).optional(), label: z.string().optional(), icon: z.string().optional() }).strict()),
  /** Controls the orbital leaves for an embedding organism (`emitsScope external`) that nothing in it handles: an importer must route each. */
  forwards: z.array(z.object({ trait: z.string(), event: z.string(), via: z.array(z.string()) }).strict()).optional(),
}).strict();
export type OrbitalDescription = z.infer<typeof OrbitalDescriptionSchema>;

/** What `behavior/describe` returns for an orbital value or a whole behavior (`orb behaviors describe --json`). */
export const BehaviorDescriptionSchema = z.object({
  behavior: z.string(),
  config: DeclaredTraitConfigSchema,
  knobs: z.array(KnobFieldSchema),
  orbitals: z.array(OrbitalDescriptionSchema),
  /** The behaviors this one imports (`uses … from`): what it already contains. */
  uses: z.array(z.string()).optional(),
}).strict();
export type BehaviorDescription = z.infer<typeof BehaviorDescriptionSchema>;

/** What `program/eval` returns: where the validated program was written, and its traits as values. */
export interface EvaluatedProgram {
  /** Workspace-relative specifier of the written program (`./orbitals/<name>` by default). */
  readonly behavior: string;
  readonly traits: readonly TraitValue[];
  /** The written program as a behavior value, ready to embed. */
  readonly value: BehaviorRef;
}

/** A validator finding `program/eval` returns as data (the shape `orb validate --json` reports). A type alias, not an interface, so it is an `EventPayload` member. */
export type ProgramValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
};

/**
 * A trait value made runnable by its host: the resolved one-orbital wrapper
 * program that imports the value's owning orbital (`only { T }`, overrides as
 * `traits { T { … } }`), the mounted trait's name in it, and the page showing it.
 */
export interface MountedTraitValue {
  readonly schema: OrbitalSchema;
  /** The orbital the wrapper mounts the value as. */
  readonly orbital: string;
  /** The value's trait under the import prefix (`<orbital><Trait>`). */
  readonly trait: string;
  readonly pagePath?: string;
}

/** A behavior value made runnable by its host: the resolved program as written and the page it opens on. */
export interface MountedBehaviorValue {
  readonly schema: OrbitalSchema;
  /** The program's first page path (where the frame's scoped router starts). */
  readonly firstPage: string;
}

/** Mounting outcome for a behavior value; validator issues come back as data. */
export type BehaviorValueMountResult =
  | { readonly ok: true; readonly mounted: MountedBehaviorValue }
  | { readonly ok: false; readonly error: string; readonly errors?: readonly ProgramValidationIssue[] };

/** Mounting outcome — the validator's issues come back as data when the value does not validate where it is bound. */
export type TraitValueMountResult =
  | { readonly ok: true; readonly mounted: MountedTraitValue }
  | { readonly ok: false; readonly error: string; readonly errors?: readonly ProgramValidationIssue[] };
