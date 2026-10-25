/**
 * FactorySignature → JsonSchema generator.
 *
 * Walks a resolved `FactorySignature` (post `inheritCallSiteOverrideTypes`)
 * and emits a JSON Schema for the corresponding `AnalysisOrbitalParams`
 * shape: `entityName / pagePath / fields / traitOverrides / extraTraits
 * / pages / theme`. The `traitOverrides` property is the densest part — one
 * entry per trait with a typed `config` sub-schema reflecting
 * `overridableConfigKeys` (type + enum + items + properties + label +
 * synonyms metadata).
 *
 * The output is consumed by V2's tool-calling layer
 * (`@almadar-io/agent`'s coordinator + per-orbital subagent) via
 * OpenAI's `tool.parameters` with `strict: true` — the LLM is masked
 * to the schema and physically cannot emit unknown trait names,
 * invented knob keys, or out-of-set enum values.
 *
 * `additionalProperties: false` is set at every level so unknown keys
 * are rejected. Inherited descriptive metadata (label, description,
 * synonyms) flows into `description` / `x-label` / `x-synonyms`
 * extension keywords so studio UIs + prompt rendering can use the
 * same single artifact.
 */
import { getAllPatternTypes } from '../patterns/helpers/prompt-helpers.js';
import { persistenceModeAllowsOverrides } from '../types/entity.js';
import { UI_SLOTS } from '../types/effect.js';
import type { EntityField } from '../types/field.js';
import type {
  FactoryConfigParam,
  FactoryParamValue,
  FactorySignature,
  FactoryTraitSignature,
  JsonSchema,
  JsonSchemaType,
  JsonValue,
} from './types.js';

// ============================================================================
// Top-level: signature → params schema
// ============================================================================

export function signatureToParamsSchema(
  signature: FactorySignature,
  options?: { readonly themeNames?: readonly string[] },
): JsonSchema {
  // `trait`-typed knobs must hold `@trait.<TraitName>` naming a trait on
  // THIS orbital — the exact contract rabit's `validateTraitTypedConfigRefs`
  // enforces at fill time with a retry. Baking the same values as an enum
  // makes the invalid reference inexpressible instead of caught-and-retried
  // (SCAN-TRAITREF-KNOB-1: the fill spent its attempts on
  // `sidebarTrait = "AuthorDirectory"` and the HIT demoted).
  const traitRefValues = signature.traits.map((t) => `@trait.${t.name}`).sort();
  const traitProps: { [key: string]: JsonSchema } = {};
  for (const trait of signature.traits) {
    // An imported trait is carried, not overridable at the call site.
    if (trait.importedFrom !== undefined) continue;
    // A trait can never be its OWN content/sidebar slot — the compiler rejects
    // it as `ORB_BINDING_TRAIT_SELF_REFERENCE`. Offering it is an always-invalid
    // value in a closed enum: measured 1,238 of 1,238 trait-typed knobs carried
    // their own trait, and a fill that picked it demoted a factory HIT
    // (std-lms/AppointmentPolicyFromStdOrbital). Excluded per-trait rather than
    // globally — a SIBLING trait remains a legitimate value.
    const selectableRefs = traitRefValues.filter((v) => v !== `@trait.${trait.name}`);
    const traitSchema = traitToOverrideSchema(trait, selectableRefs);
    if (traitSchema !== null) {
      traitProps[trait.name] = traitSchema;
    }
  }

  const allowPersistenceOverride = persistenceModeAllowsOverrides(
    signature.entities[0]?.persistence,
    signature.entities[0]?.dataBearing ?? false,
  );

  const properties: { [key: string]: JsonSchema } = {
    entityName: {
      type: 'string',
      description: 'PascalCase singular entity rename (e.g. "Listing", "Member"). Renames the DOMAIN concept and rewrites every `@Entity.*` reference. Use this when the user wants to rename the THING, not where it\'s stored.',
    },
    pagePath: {
      type: 'string',
      description: "URL path override for the orbital's first page.",
    },
    fields: {
      type: 'array',
      description: 'Extra entity fields appended to the canonical entity. Caller wins on name collision.',
      items: ENTITY_FIELD_SCHEMA,
    },
    traitOverrides: Object.keys(traitProps).length > 0
      ? {
          type: 'object',
          additionalProperties: false,
          description:
            'Per-trait knob overrides keyed on the canonical trait name. Each value can include `config` (knob values), `linkedEntity` (rebind), `events` (per-key rename map), `listens` (cross-orbital subscriptions), `emitsScope` (`internal` keeps emits local; `external` lets sibling orbitals listen), and `name` (rename the inlined trait). Only the traits + knobs shown here are valid — the schema rejects unknown keys.',
          properties: traitProps,
        }
      : { type: 'object', additionalProperties: false, properties: {} },
    extraTraits: {
      type: 'array',
      description: 'Sibling traits to compose beyond the factory-authored stack.',
      items: EXTRA_TRAIT_SCHEMA,
    },
    pages: {
      type: 'array',
      description: 'Per-page overrides keyed by canonical page name.',
      items: PAGE_OVERRIDE_SCHEMA,
    },
    theme: {
      type: 'string',
      // Theme names are injected by the caller rather than harvested from
      // `@almadar-ui/themes/*.css` — core is UPSTREAM of `@almadar/ui`, which
      // owns the theme CSS, and cannot read the filesystem to discover it.
      ...(options?.themeNames !== undefined && options.themeNames.length > 0
        ? { enum: [...options.themeNames] }
        : {}),
      description:
        'Theme key — the full `data-theme` value applied to the layout root (e.g. linear-clean-light, terminal-dark, game-adventure-dark). Plan-level: pick ONE for the whole app — it is threaded to every orbital. Omit to leave the factory default.',
    },
  };

  if (signature.config && signature.config.length > 0) {
    const configProps: { [key: string]: JsonSchema } = {};
    for (const knob of signature.config) {
      configProps[knob.key] = knobToSchema(knob, undefined, traitRefValues);
    }
    properties.config = {
      type: 'object',
      additionalProperties: false,
      description: "This orbital's own declared knobs (Orbital.config). Only the keys shown are valid.",
      properties: configProps,
    };
  }

  if (allowPersistenceOverride) {
    properties.collection = {
      type: 'string',
      description: 'Override the persistence collection / table name. Defaults to `plural(entityName).toLowerCase()`. Use this when the user names the database/table/storage location ("save them under X", "the table is called X", "in our database it\'s X") — NOT when they rename the domain concept (that\'s `entityName`).',
    };
    properties.persistence = {
      type: 'string',
      enum: ['persistent', 'runtime'],
      description: 'Override the entity persistence mode. `persistent` = stored in the configured backend; `runtime` = in-memory session-scoped only.',
    };
  }

  const schema: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    description: `Typed params for ${signature.organism} / ${signature.orbital}. Empty {} = factory defaults.`,
    properties,
  };
  assertNoUnsatisfiableEnum(schema, `${signature.organism}/${signature.orbital}`);
  return schema;
}

/**
 * The standing form of the self-reference bug: **a closed enum must not be
 * empty.** An empty `enum` permits nothing, so every value the model can
 * produce is rejected and the HIT demotes with no path back — strictly worse
 * than a wrong default, and invisible because each individual construct is
 * still legal JSON Schema.
 *
 * This is deliberately the GENERAL check rather than a second per-slot filter.
 * Each enum here is built by projecting one candidate list across many slots
 * (traits, entities, events, patterns, themes), and every such projection can
 * narrow to nothing for some signature — the trait case did, at 1,238 of 1,238
 * offers, and was found only because a scan happened to trip on it. Anything
 * that empties a candidate set now fails the bake loudly instead of shipping a
 * schema the compiler will always reject.
 */
export function assertNoUnsatisfiableEnum(node: JsonSchema, where: string, path = ''): void {
  if (Array.isArray(node.enum) && node.enum.length === 0) {
    throw new Error(
      `[signatures] ${where}: empty enum at "${path || '<root>'}" — the schema permits no value, ` +
        'so every fill for this knob is rejected. Omit the knob instead of offering an unsatisfiable one.',
    );
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    assertNoUnsatisfiableEnum(child, where, path === '' ? key : `${path}.${key}`);
  }
  if (node.items !== undefined) assertNoUnsatisfiableEnum(node.items, where, `${path}[]`);
}

// ============================================================================
// Trait override schema — one entry per trait in the signature
// ============================================================================

function traitToOverrideSchema(
  trait: FactoryTraitSignature,
  traitRefValues?: ReadonlyArray<string>,
): JsonSchema | null {
  // Skip traits with zero overridable knobs AND no other override surface.
  // A `@rebindable` trait always has an override surface (linkedEntity), so
  // it keeps an entry even with zero config knobs.
  if (trait.overridableConfigKeys.length === 0 && trait.entityRebindable !== true) return null;

  const knobProps: { [key: string]: JsonSchema } = {};
  for (const knob of trait.overridableConfigKeys) {
    // A trait-typed knob on a trait with no SELECTABLE sibling has no valid
    // value at all — the only candidate was the enclosing trait, which the
    // compiler rejects as ORB_BINDING_TRAIT_SELF_REFERENCE. Omit it, the same
    // way `listens` is omitted for render-only traits below: an unsatisfiable
    // knob must not be offered.
    //
    // Without this the self-reference filter would silently DEGRADE such a
    // knob to a free string (`knobToSchema` only builds the enum when the set
    // is non-empty), reopening SCAN-TRAITREF-KNOB-1 for exactly the orbitals
    // the filter was meant to protect. `undefined` still means "topology
    // unknown" (legacy catalog) and keeps the free-string surface; only a
    // DEFINED-and-empty set is unsatisfiable.
    if (knob.type === 'trait' && traitRefValues !== undefined && traitRefValues.length === 0) {
      continue;
    }
    knobProps[knob.key] = knobToSchema(knob, trait, traitRefValues);
  }

  // `linkedEntity` is ONLY offered for traits whose binding the atom author
  // marked `@rebindable`. For fixed-binding traits it's omitted entirely so
  // the LLM physically cannot author a rebind the validator would reject.
  // rabit narrows the value to a closed enum of the organism's entities.
  const properties: { [key: string]: JsonSchema } = {
    config: {
      type: 'object',
      additionalProperties: false,
      properties: knobProps,
    },
  };
  if (trait.entityRebindable === true) {
    properties.linkedEntity = {
      type: 'string',
      description: "Rebind this trait to a different entity in the organism (rewrites every @entity.* / ref / fetch / persist binding inside it).",
    };
  }

  // `listens[].triggers` must name an event THIS trait's own state machine
  // transitions on (ORB_X_LISTEN_TRIGGER_UNMATCHED otherwise). When the
  // signature carries the trait's topology, mask the LLM to it: enum the
  // triggers when transitions exist, and omit `listens` entirely for
  // render-only traits (zero transitions — no listen entry can ever be
  // valid; target the sibling trait that owns the transition instead).
  // Unknown topology (legacy catalogs) keeps the free-string surface.
  const triggersSchema: JsonSchema =
    trait.transitionEvents !== undefined && trait.transitionEvents.length > 0
      ? {
          type: 'string',
          enum: [...trait.transitionEvents],
          description: 'Local state-machine event fired when the subscription matches. Must be one of the events this trait\'s own transitions already react to.',
        }
      : {
          type: 'string',
          description: 'Local state-machine event fired when the subscription matches.',
        };
  const listensProperty: { [key: string]: JsonSchema } =
    trait.transitionEvents !== undefined && trait.transitionEvents.length === 0
      ? {}
      : {
          listens: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['event', 'triggers'],
              properties: {
                event: { type: 'string', description: 'Event key to subscribe to (bare name, no orbital prefix).' },
                triggers: triggersSchema,
                scope: { type: 'string', enum: ['internal', 'external'], description: '`internal` = same-orbital events. `external` = events from sibling orbitals (use this for cross-orbital reactivity).' },
              },
            },
            description: 'Replace this trait\'s `listens` entirely. Empty array clears upstream listeners. For cross-orbital reactivity, add an entry with `scope: "external"` matching the source orbital\'s emit event.',
          },
        };

  return {
    type: 'object',
    additionalProperties: false,
    description: `Override knobs for ${trait.name}.`,
    properties: {
      ...properties,
      name: {
        type: 'string',
        description: "Rename the inlined trait at the call site. Does NOT change topology — just the trait's local name.",
      },
      events: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Per-key event rename map (e.g. `{ "OPEN": "ADD_ITEM" }`). Rewrites the events array, transition triggers, emit/listen event keys, and `["emit", X]` SExpression literals inside the trait.',
      },
      ...listensProperty,
      emitsScope: {
        type: 'string',
        enum: ['internal', 'external'],
        description: '`internal` = emits stay local to this orbital. `external` = sibling orbitals can listen. Set to `external` when another orbital needs to react to this trait\'s events (counter updates, list refreshes, badges, etc.).',
      },
    },
  };
}

// ============================================================================
// Knob schema — FactoryConfigParam → JsonSchema for one knob
// ============================================================================

function knobToSchema(
  knob: FactoryConfigParam,
  trait?: FactoryTraitSignature,
  traitRefValues?: ReadonlyArray<string>,
): JsonSchema {
  const out: JsonSchema = {};

  // Map the knob's declared type tag to a JSON Schema type.
  const baseType = mapKnobType(knob.type);
  if (baseType !== null) out.type = baseType;

  // Enum constraint — knob.enumValues becomes JSON Schema's `enum`.
  if (knob.enumValues && knob.enumValues.length > 0) {
    out.enum = [...knob.enumValues];
    // If type wasn't already string-ish, pin it to string for enum.
    if (!out.type) out.type = 'string';
  }

  // `slot`-typed knobs are a CLOSED registry (UI_SLOTS) — unconstrained,
  // the fill invents values like 'inline' that hard-fail the validator
  // (ORB_T_INVALID_SLOT_DEFAULT) and demote the whole HIT. Same posture
  // as the listens-triggers enum: constrain at the schema so an invalid
  // value can't reach the factory.
  if (knob.type === 'slot' && out.enum === undefined) {
    out.enum = [...UI_SLOTS];
  }

  // `pattern`-typed knobs are the same closed-registry shape as slots —
  // unconstrained, the fill invents names like 'full' that hard-fail
  // ORB_T_INVALID_PATTERN_DEFAULT + ORB_RUI_INVALID_PATTERN and demote the
  // HIT (SCAN-PATTERN-KNOB-1, organism-scan run12). Enum over the pattern
  // registry's type names; same self-consistency guard as the other pins.
  if (knob.type === 'pattern' && out.enum === undefined) {
    const patternTypes: readonly string[] = getAllPatternTypes();
    const selfConsistent =
      typeof knob.default !== 'string' ||
      knob.default === '' ||
      patternTypes.includes(knob.default);
    if (patternTypes.length > 0 && selfConsistent) {
      out.enum = [...patternTypes].sort();
    }
  }

  // `trait`-typed knobs: enum over the orbital's canonical `@trait.<name>`
  // references — the same value set `validateTraitTypedConfigRefs` accepts.
  // Same guards as the other reference pins: skip when unavailable or when
  // the knob's own non-empty default is missing from the set.
  if (
    knob.type === 'trait' &&
    out.enum === undefined &&
    traitRefValues !== undefined &&
    traitRefValues.length > 0
  ) {
    const selfConsistent =
      typeof knob.default !== 'string' ||
      knob.default === '' ||
      traitRefValues.includes(knob.default);
    if (selfConsistent) {
      out.enum =
        typeof knob.default === 'string' && knob.default === ''
          ? ['', ...traitRefValues]
          : [...traitRefValues];
    }
  }

  // `event`-DECLARED knobs (the `.lolo` type, never inferred) reference an
  // event in the owning trait's vocabulary — unconstrained, the fill
  // invents literals like 'note.search' that fail
  // ORB_T_INVALID_EVENT_DEFAULT and demote the HIT (SCAN-EVENT-KNOB-1).
  // Enum = the trait's event union from the signature, plus '' (the
  // validator's default-off outlet). Canonical names stay correct under
  // call-site renames because the inline pass rename-folds event-typed
  // knob values (event_typed_knob_rename_fold.rs). Guards: skip when the
  // union is empty (vacuous, compiler parity) or when the knob's own
  // non-empty default is missing from it (an enum that forbids its own
  // default is wrong by construction).
  //
  // A-UNIFY: a DEFINER knob (A-UNIFY spells it `: event` same as a
  // reference knob) is exempt — its value CREATES the event name rather
  // than referencing one, so pinning it to the trait's existing vocabulary
  // would forbid the very name it's meant to introduce. Left UNPINNED is
  // deliberate and correct: any name is valid by construction, a definer
  // cannot go stale. Do not "fix" this back to a pin.
  const isDefinerKnob = trait?.definerKnobs?.includes(knob.key) ?? false;
  if (knob.type === 'event' && isDefinerKnob) {
    out['x-role'] = 'definer';
  }
  if (knob.type === 'event' && !isDefinerKnob && out.enum === undefined && trait !== undefined) {
    const vocabulary = new Set<string>([
      ...trait.emittedEvents,
      ...trait.listenedEvents,
      ...(trait.transitionEvents ?? []),
    ]);
    vocabulary.delete('');
    const selfConsistent =
      typeof knob.default !== 'string' ||
      knob.default === '' ||
      vocabulary.has(knob.default);
    if (vocabulary.size > 0 && selfConsistent) {
      out.enum = ['', ...[...vocabulary].sort()];
    }
  }

  // Recursive shape for arrays: `items` shape from EntityField.
  if (knob.items !== undefined) {
    out.items = entityFieldToSchema(knob.items);
    if (!out.type) out.type = 'array';
  }

  // Recursive shape for objects / structs.
  if (knob.properties !== undefined && Object.keys(knob.properties).length > 0) {
    const props: { [key: string]: JsonSchema } = {};
    for (const [k, ef] of Object.entries(knob.properties)) {
      props[k] = entityFieldToSchema(ef);
    }
    out.properties = props;
    if (!out.type) out.type = 'object';
  }

  // Default value (if any) — passes through as JsonValue.
  if (knob.default !== undefined) {
    out.default = toJsonValue(knob.default);
  }

  // Descriptive metadata — surfaced for prompt rendering + studio UIs.
  if (knob.description) out.description = knob.description;
  if (knob.label) out['x-label'] = knob.label;
  if (knob.synonyms) out['x-synonyms'] = knob.synonyms;
  if (knob.tier) out['x-tier'] = knob.tier;

  return out;
}

// ============================================================================
// EntityField → JsonSchema (used by knob.items / knob.properties / fields)
// ============================================================================

function entityFieldToSchema(field: EntityField): JsonSchema {
  // A union's `properties` are its VARIANTS by name, not members: offer one
  // closed shape per variant so a value is exactly one of them.
  if (field.type === 'union') {
    const variants = field.values
      .map((name) => field.properties?.[name])
      .filter((v): v is EntityField => v !== undefined);
    if (variants.length === 0) return {};
    return { oneOf: variants.map((v) => ({ ...entityFieldToSchema(v), additionalProperties: false })) };
  }
  const out: JsonSchema = {};
  const baseType = mapEntityFieldType(field.type);
  if (baseType !== null) out.type = baseType;

  // Enum / scalar vocabulary hint — both `enum` and scalar variants
  // carry an optional `values: string[]` in the discriminated union.
  if (
    (field.type === 'enum' ||
      field.type === 'string' ||
      field.type === 'number' ||
      field.type === 'boolean' ||
      field.type === 'date' ||
      field.type === 'timestamp' ||
      field.type === 'datetime') &&
    Array.isArray(field.values) &&
    field.values.length > 0
  ) {
    out.enum = field.values.filter(isEnumLeaf);
    if (!out.type) out.type = 'string';
  }
  if (field.type === 'array' && field.items !== undefined) {
    out.items = entityFieldToSchema(field.items);
    if (!out.type) out.type = 'array';
  }
  // Struct shape — a named struct like `[ItemAction]` lowers to an object
  // EntityField whose `properties` carry the per-field sub-tree with
  // `required` flags. Projecting them (plus `required`) lets the ajv
  // contract boundary reject a wrong field name (e.g. `action` instead of
  // `event`) at fill time instead of the factory type-check failing the
  // build afterwards and demoting the orbital.
  if (field.properties !== undefined && Object.keys(field.properties).length > 0) {
    const props: { [key: string]: JsonSchema } = {};
    const required: string[] = [];
    for (const [k, ef] of Object.entries(field.properties)) {
      props[k] = entityFieldToSchema(ef);
      if (ef.required === true) required.push(k);
    }
    out.properties = props;
    if (required.length > 0) out.required = required;
    if (!out.type) out.type = 'object';
  }
  if (field.default !== undefined) {
    out.default = toJsonValue(field.default);
  }
  return out;
}

function isEnumLeaf(v: JsonValue): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

// ============================================================================
// Type mappers
// ============================================================================

function mapKnobType(knobType: string): JsonSchemaType | null {
  // Strip array bracket wrapper for `[T]` types.
  if (knobType.startsWith('[') && knobType.endsWith(']')) return 'array';
  switch (knobType) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
    case 'float':
      return knobType === 'integer' ? 'integer' : 'number';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'object':
    // An orbital value is `{ behavior, orbital, …import body }` on the wire; a behavior value is `{ behavior }`.
    case 'orbital':
    case 'behavior':
      return 'object';
    case 'array':
      return 'array';
    case 'enum':
      return 'string';
    // String-valued reference tags: a trait ref is "@trait.<Name>", a
    // slot/pattern/icon/asset is a registry name, an event is an event
    // key, a date is an ISO string. These were mis-emitted as `object`
    // (11k knobs catalog-wide carried an object type with a string
    // default), which was harmless while tool schemas were advisory but
    // breaks hard validation.
    case 'trait':
    case 'slot':
    case 'pattern':
    case 'secret':
    case 'icon':
    case 'asset':
    case 'event':
    case 'EventAddress':
    case 'CallKey':
    case 'field':
    case 'date':
      return 'string';
    case 'render-ui':
      // First-class render-ui SExpr tree (Layer 3 variant-body knob).
      // The runtime substitutes the value into the parent atom's
      // `(render-ui main @config.X)` body verbatim. Schema-wise it's a
      // recursive object with `type: "<pattern-name>"` + nested
      // `children`; for LLM JSON Schema we surface it as `object` and
      // rely on the knob description + pattern-registry awareness for
      // shape guidance.
      return 'object';
    // Polymorphic values: a `node` accepts a string leaf OR a render-ui
    // tree; `json`/`unknown` carry arbitrary JSON. No `type` — the
    // schema stays structurally honest instead of over-constraining.
    case 'node':
    case 'json':
    case 'unknown':
      return null;
    default:
      // Custom struct types (e.g. `FormatOption`) — `knobToSchema` pins
      // `object` iff `knob.properties` captured a shape; otherwise the
      // knob stays untyped rather than claiming a shape we don't know.
      return null;
  }
}

export function mapEntityFieldType(fieldType: string): JsonSchemaType | null {
  switch (fieldType) {
    case 'string':
    case 'date':
    case 'timestamp':
    case 'datetime':
    // JSON Schema has no email/url/phone/uuid/image primitive — the declared
    // domain is carried on the signature's own `type` field (see
    // `asSchemaFieldType`), not here. This maps to the WIRE shape only.
    case 'email':
    case 'url':
    case 'phone':
    case 'uuid':
    case 'image':
    case 'bytes':
      return 'string';
    case 'number':
    case 'instant':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
    case 'relation':
    case 'orbital':
    case 'behavior':
      return 'object';
    case 'enum':
      return 'string';
    case 'trait':
    case 'slot':
    case 'pattern':
    case 'secret':
      return 'string';
    // Phase B (SCAN-EVENT-KNOB-2): event-name reference — a string at the
    // wire level, same as `mapKnobType`'s `case 'event'` (that asymmetry
    // — this function fell to `default: null`, leaving struct-field
    // `event` members with NO json-schema type — was the bug).
    case 'event':
    case 'EventAddress':
    case 'CallKey':
    case 'field':
      return 'string';
    // Polymorphic renderable content: a node accepts a string leaf OR a
    // render-ui tree — no JSON-Schema `type` constraint, mirroring
    // `mapKnobType`'s `case 'node'`. (The default would return null too;
    // explicit for parity and self-documentation.)
    case 'node':
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Coerce arbitrary value into JsonValue (no unknown leaks)
// ============================================================================

/**
 * Widen the two JSON-shaped value types the signature carries
 * (`FactoryConfigParam.default` is `FactoryParamValue`, `EntityField.default`
 * is `JsonValue`) into the mutable `JsonValue` a schema `default` holds.
 *
 * Typed as their union rather than `unknown`: both are already JSON by
 * construction, so no escape hatch is needed and the recursion stays checked.
 * Non-finite numbers become `null` because `NaN`/`Infinity` have no JSON
 * encoding and would serialise as `null` anyway — better to say so here than
 * to let `JSON.stringify` decide silently.
 */
function toJsonValue(value: FactoryParamValue | JsonValue): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  const out: { [key: string]: JsonValue } = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = toJsonValue(v);
  }
  return out;
}

// ============================================================================
// Shared schemas for entity field / extra trait / page override entries
// ============================================================================

/**
 * Discriminated-union shape for an entity field. Each `oneOf` branch
 * pins `type` to a literal and lists its dependent required slots:
 *   - `type === 'enum'` REQUIRES `values: string[]`
 *   - `type === 'relation'` REQUIRES `relation: { entity, cardinality }`
 *   - `type === 'array'` MAY carry `items` (optional for legacy
 *     codegen emit; lolo + Rust validator handle typed-element cases)
 *   - other scalars accept the base shape
 *
 * `additionalProperties: false` at every level rejects unknown keys at
 * the LLM tool-call layer. Mirrors `EntityField` discriminated union
 * from `@almadar/core` (8.6.2).
 */
const ENTITY_FIELD_BASE_PROPS = {
  name: { type: 'string' as JsonSchemaType, description: 'Field name (camelCase).' },
  required: { type: 'boolean' as JsonSchemaType },
  primaryKey: { type: 'boolean' as JsonSchemaType },
  intrinsic: { type: 'boolean' as JsonSchemaType },
  min: { type: 'number' as JsonSchemaType },
  max: { type: 'number' as JsonSchemaType },
  description: { type: 'string' as JsonSchemaType },
  synonyms: { type: 'string' as JsonSchemaType },
  mock: { type: 'string' as JsonSchemaType },
  mergedFrom: { type: 'string' as JsonSchemaType },
  projectedFrom: {
    type: 'object' as JsonSchemaType,
    additionalProperties: false,
    required: ['type'],
    properties: { type: { type: 'string' as JsonSchemaType }, field: { type: 'string' as JsonSchemaType } },
  },
  properties: { type: 'object' as JsonSchemaType, additionalProperties: { $ref: 'urn:almadar:entity-field#/$defs/field' } },
  values: { type: 'array' as JsonSchemaType, items: { type: 'string' as JsonSchemaType } },
  default: {
    type: ['string', 'number', 'boolean', 'null', 'array', 'object'] as ReadonlyArray<JsonSchemaType>,
  } as JsonSchema,
};
// Includes the semantic domains: without them an L1 factory HIT cannot express
// an email field at all, so `fill_params` could never produce one.
const SCALAR_FIELD_TYPES: ReadonlyArray<string> = [
  'string', 'number', 'int', 'boolean', 'date', 'timestamp', 'datetime', 'instant',
  'email', 'url', 'phone', 'uuid', 'image', 'money',
  'file', 'bytes', 'trait', 'slot', 'pattern', 'node', 'event', 'EventAddress', 'CallKey', 'SExpr',
];
const SCALAR_FIELD_BRANCH: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type'],
  properties: {
    ...ENTITY_FIELD_BASE_PROPS,
    type: { type: 'string', enum: SCALAR_FIELD_TYPES, description: 'Field type tag.' },
  },
};
const ENUM_FIELD_BRANCH: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'values'],
  properties: {
    ...ENTITY_FIELD_BASE_PROPS,
    type: { type: 'string', enum: ['enum'], description: 'Enum field.' },
    values: {
      type: 'array',
      description: 'Closed string vocabulary. e.g. ["active","inactive","pending"].',
      minItems: 1,
      items: { type: 'string' },
    },
  },
};
const RELATION_FIELD_BRANCH: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'relation'],
  properties: {
    ...ENTITY_FIELD_BASE_PROPS,
    type: { type: 'string', enum: ['relation'], description: 'Relation (FK) field.' },
    relation: {
      type: 'object',
      additionalProperties: false,
      required: ['entity'],
      properties: {
        entity: { type: 'string', description: 'Sibling entity name (PascalCase singular).' },
        entityId: { type: 'string' },
        cardinality: { type: 'string', enum: ['one', 'many'] },
        field: { type: 'string' },
        onDelete: { type: 'string', enum: ['cascade', 'nullify', 'restrict'] },
      },
      description: 'Relation target. `cardinality: "one"` for FK (customerId → one Customer); "many" for collection (tags → many Tag).',
    },
  },
};
const ARRAY_FIELD_BRANCH: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type'],
  properties: {
    ...ENTITY_FIELD_BASE_PROPS,
    type: { type: 'string', enum: ['array'], description: 'Array field.' },
    items: { $ref: 'urn:almadar:entity-field#/$defs/field' },
  },
};
// A nested structure within the entity: an `object` declares its members
// (struct) or its value type (map). A shapeless `object` is not offered —
// `orb validate` rejects it (ORB_T_GENERIC_TYPE_DEPRECATED).
const OBJECT_FIELD_BRANCH: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type'],
  anyOf: [{ required: ['properties'] }, { required: ['items'] }],
  properties: {
    ...ENTITY_FIELD_BASE_PROPS,
    type: { type: 'string', enum: ['object'], description: 'Struct members or map value shape.' },
    items: { $ref: 'urn:almadar:entity-field#/$defs/field' },
  },
};
const UNION_FIELD_BRANCH: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'values'],
  properties: {
    ...ENTITY_FIELD_BASE_PROPS,
    type: { type: 'string', enum: ['union'] },
    values: { ...ENTITY_FIELD_BASE_PROPS.values, minItems: 1 },
  },
};
const TUPLE_FIELD_BRANCH: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'properties'],
  properties: {
    ...ENTITY_FIELD_BASE_PROPS,
    type: { type: 'string', enum: ['tuple'] },
    properties: { ...ENTITY_FIELD_BASE_PROPS.properties, minProperties: 1 },
  },
};
const ENTITY_FIELD_BRANCHES: ReadonlyArray<JsonSchema> = [
  SCALAR_FIELD_BRANCH,
  ENUM_FIELD_BRANCH,
  RELATION_FIELD_BRANCH,
  ARRAY_FIELD_BRANCH,
  OBJECT_FIELD_BRANCH,
  UNION_FIELD_BRANCH,
  TUPLE_FIELD_BRANCH,
];
export const ENTITY_FIELD_SCHEMA: JsonSchema = {
  $id: 'urn:almadar:entity-field',
  oneOf: ENTITY_FIELD_BRANCHES,
  $defs: {
    field: {
      oneOf: ENTITY_FIELD_BRANCHES.map(branch => ({ ...branch, required: branch.required?.filter(key => key !== 'name') })),
    },
  },
};

const EXTRA_TRAIT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'as', 'ref'],
  properties: {
    from: { type: 'string', description: 'Registry path (e.g. std/behaviors/std-approval-request).' },
    as: { type: 'string', description: 'Local alias used in `ref`.' },
    ref: { type: 'string', description: 'Trait reference (Alias.traits.X).' },
    name: { type: 'string', description: 'Optional rename of the inlined trait.' },
    linkedEntity: { type: 'string', description: 'Optional entity rebinding.' },
    emitsScope: { type: 'string', enum: ['internal', 'external'] },
  },
};

const PAGE_OVERRIDE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'Canonical page name from the orbital.' },
    path: { type: 'string', description: 'URL path override.' },
    linkedEntity: { type: 'string', description: 'Rebind the primary entity.' },
  },
};
