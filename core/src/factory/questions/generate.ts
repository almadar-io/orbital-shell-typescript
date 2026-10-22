/**
 * `generateQuestions(plan, catalog, ruleOverlay?)`.
 *
 * Deterministic, no LLM call. Walks each `FactoryCallSite` in the
 * durable plan against its matching `FactorySignature` and emits one
 * open question per advertised knob the user hasn't already filled.
 *
 * Two families of questions, both source-derived:
 *
 *   1. CONFIG-KEY — one question per
 *      `signature.traits[*].overridableConfigKeys[*]`. Each entry is a
 *      `FactoryConfigParam` carrying `{ key, type, default?, label?,
 *      description?, enumValues?, items?, properties?, tier? }` lifted
 *      directly from the source `.lolo` `config { }` block. The widget
 *      choice falls out of `deriveInputType` (reads `items.properties`
 *      and `properties` so structured types render proper editors, not
 *      JSON textareas); the prompt comes from `label` (or a humanized
 *      fallback of `key`); the default value pre-fills the widget.
 *      Knobs tagged `tier: 'internal'` are filtered out entirely.
 *
 *   2. CAPABILITY-DRIVEN — one question per unique
 *      `signature.traits[*].capabilities[*]` tag NOT already covered
 *      by `ruleOverlay.rules[].capability`. Surfaces a `set-rule`
 *      mutation template scoped to the bound entity.
 *
 * @packageDocumentation
 */

import type {
  FactoryCallSite,
  FactoryConfigParam,
  FactoryParamValue,
  FactorySignature,
  FactorySignatureEntityField,
  FactoryTraitSignature,
} from '../types.js';
import type { RuleOverlay } from '../overlays.js';
import type { EntityField } from '../../types/field.js';
import type {
  DomainQuestion,
  DomainQuestionInputType,
} from './types.js';

export function generateQuestions(
  plan: ReadonlyArray<FactoryCallSite>,
  catalog: ReadonlyArray<FactorySignature>,
  ruleOverlay?: RuleOverlay,
  /**
   * Optional user-authored prompt from the current session. Carried
   * through so downstream consumers (route handlers, ranking passes)
   * can re-order questions by relevance without re-generating. Does
   * not affect the emitted set — only threading and ordering.
   */
  _userPrompt?: string,
): DomainQuestion[] {
  const out: DomainQuestion[] = [];
  const ruleCapabilities = collectRuleCapabilities(ruleOverlay);

  for (const call of plan) {
    const signature = findSignature(catalog, call.organism, call.orbital);
    if (!signature) continue;
    out.push(...configKeyQuestions(call, signature));
    out.push(...entityFieldQuestions(call, signature));
    out.push(...capabilityQuestions(call, signature, ruleCapabilities));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Config-key questions — derived from the source `config { }` declaration
// ---------------------------------------------------------------------------

const TIER_D_NAMED_PRIMITIVES = new Set([
  'layoutMode',
  'layoutPattern',
  'viewPattern',
  'detailPattern',
  'detailSlot',
  'contentTrait',
]);

const TIER_D_TYPES = new Set(['trait', 'slot', 'pattern', 'event']);

function configKeyQuestions(
  call: FactoryCallSite,
  signature: FactorySignature,
): DomainQuestion[] {
  const out: DomainQuestion[] = [];
  for (const trait of signature.traits) {
    for (const param of trait.overridableConfigKeys) {
      if (param.tier === 'internal') continue;
      if (TIER_D_TYPES.has(param.type)) continue;
      if (TIER_D_NAMED_PRIMITIVES.has(param.key)) continue;
      out.push(buildConfigKeyQuestion(call, trait, param));
    }
  }
  return out;
}

function buildConfigKeyQuestion(
  call: FactoryCallSite,
  trait: FactoryTraitSignature,
  param: FactoryConfigParam,
): DomainQuestion {
  // `@label` renders verbatim; the fallback is a type guard, not inference —
  // a domain-tier knob reaching it is a missing-`@label` source defect.
  const question = param.label ?? humanizeKey(param.key);
  // Call-site override (organism pre-pinned this knob) takes precedence
  // over the atom-author's default. The question still renders so the
  // user can confirm or change the pre-pinned value.
  const callSiteOverride = callSiteOverrideValue(call, trait.name, param.key);
  const effectiveDefault =
    callSiteOverride !== undefined ? callSiteOverride : param.default;

  // `helpText` carries the param's authored description (how to answer).
  // `reason` is the distinct "why you're seeing this" — only set when it
  // adds information beyond what helpText already says.
  const helpText = param.description;
  const syntheticReason =
    `Customizes "${param.key}" on the ${trait.name} trait. ` +
    (effectiveDefault !== undefined
      ? `Default: ${stringifyDefault(effectiveDefault)}.`
      : `No default — leave blank to inherit the factory's behavior.`);
  const reason = helpText !== undefined ? undefined : syntheticReason;

  const isAdvanced = !isPrimaryTier(param.tier);

  const out: DomainQuestion = {
    id: `${factoryCallPlanOrbitalName(call)}.${trait.name}.${param.key}`,
    orbitalName: factoryCallPlanOrbitalName(call),
    question,
    inputType: deriveInputType(param),
    mutationTemplate: {
      kind: 'set-trait-override-config',
      orbitalName: factoryCallPlanOrbitalName(call),
      traitName: trait.name,
      configKey: param.key,
    },
  };
  if (reason !== undefined) {
    out.reason = reason;
  }
  if (helpText !== undefined) {
    out.helpText = helpText;
  }
  if (effectiveDefault !== undefined) {
    out.defaultValue = effectiveDefault;
  }
  if (param.enumValues && param.enumValues.length > 0) {
    out.suggestedAnswers = param.enumValues;
  }
  if (param.items) {
    out.itemSchema = param.items;
  }
  if (param.properties) {
    out.objectSchema = param.properties;
  }
  if (param.tier) {
    out.tier = param.tier;
  }
  if (isAdvanced) {
    out.advanced = true;
  }
  const weight = tierWeight(param.tier);
  out.weight = weight;
  out.priority = weight;
  return out;
}

/**
 * Impact weight by decision kind — the spine of both the wizard's
 * prescient-first ordering and its Confidence score. policy/domain are the
 * decisions that change what the business does; infra is operational wiring;
 * presentation is polish. Untagged defaults to presentation (1). `internal`
 * never reaches here (filtered in `configKeyQuestions`).
 */
function tierWeight(tier: FactoryConfigParam['tier']): number {
  switch (tier) {
    case 'domain':
    case 'policy':
      return 3;
    case 'infra':
      return 2;
    case 'internal':
      return 0;
    case 'presentation':
    default:
      return 1;
  }
}

/** `true` only for the two tiers that render inline (not collapsed). */
function isPrimaryTier(tier: FactoryConfigParam['tier']): boolean {
  return tier === 'domain' || tier === 'policy';
}

function callSiteOverrideValue(
  call: FactoryCallSite,
  traitName: string,
  configKey: string,
): FactoryParamValue | undefined {
  const override = call.params.traitOverrides?.[traitName];
  if (!override?.config) return undefined;
  if (!Object.prototype.hasOwnProperty.call(override.config, configKey)) {
    return undefined;
  }
  return override.config[configKey] as FactoryParamValue;
}

/**
 * Pick a widget for a config-key question from the param's typed
 * declaration + its structural carriers. The type tag is lifted
 * verbatim from `.lolo`; `items.properties` and `properties` carry the
 * per-element / per-property schema for structured types so the studio
 * can render a real form instead of a JSON textarea.
 *
 *  - `[T]` with `items.properties` → `listOfObjects` (repeatable form)
 *  - `[T]` with `enumValues`       → `multiselect` (closed checkboxes)
 *  - `[T]` otherwise               → `tagList` (free-form chips)
 *  - `object` with `properties`    → `objectForm` (per-property form)
 *  - `object` otherwise            → `text` (rare; flagged by tests)
 *  - `number` / `integer`          → `number`
 *  - `boolean`                     → `boolean`
 *  - `enum`                        → `enum`
 *  - `string` with `enumValues`    → `enum`
 *  - `string`                      → `text`
 */
export function deriveInputType(
  param: FactoryConfigParam,
): DomainQuestionInputType {
  if (param.type.startsWith('[')) {
    if (
      param.items?.properties &&
      Object.keys(param.items.properties).length > 0
    ) {
      return 'listOfObjects';
    }
    if (param.enumValues && param.enumValues.length > 0) {
      return 'multiselect';
    }
    return 'tagList';
  }
  // Typed map (`Map<K,V>`) — a dynamic-key dictionary; edited as an object.
  if (param.type.startsWith('Map<')) {
    return 'objectForm';
  }
  if (param.type === 'object') {
    if (param.properties && Object.keys(param.properties).length > 0) {
      return 'objectForm';
    }
    return 'text';
  }
  switch (param.type) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'enum';
    case 'string':
      return param.enumValues && param.enumValues.length > 0 ? 'enum' : 'text';
    default:
      return 'text';
  }
}

/**
 * Humanize a camelCase / kebab-case key into a question prompt
 * fallback when the source `.lolo` doesn't author an explicit label.
 *
 *   `itemActions`   → `"Item Actions"`
 *   `owner-field`   → `"Owner Field"`
 *   `URL`           → `"URL"` (preserves all-caps runs)
 */
export function humanizeKey(key: string): string {
  const parts = key
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter((s) => s.length > 0);
  return parts
    .map((p) => (/^[A-Z]+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

function stringifyDefault(v: FactoryParamValue): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  return 'object';
}

// ---------------------------------------------------------------------------
// Entity-field question — lets the user add or override data model fields
// ---------------------------------------------------------------------------

/**
 * Emit one multiselect question per call site that has a canonical entity.
 *
 * The widget shows the entity's canonical fields as labelled checkboxes;
 * the user confirms or deselects them. The answer (selected field names)
 * flows through the UI's name→EntityField lookup via `fieldCandidates`,
 * then into `answersToMutations` → `set-orbital-entity-fields` → `applyEntityFields`
 * in `translate.ts` (additive/override semantics).
 *
 * `suggestedAnswers`   = candidate field name strings (drives checkbox list).
 * `defaultValue`       = the canonical field-name set pre-selected.
 * `fieldCandidates`    = name → EntityField for the UI's resolution step.
 * `fieldDescriptions`  = name → description for checkbox sub-labels.
 *
 * Phrased without an article so no "a"/"an" guess is needed: no
 * source-tagged noun phrase for an entity exists yet — the only
 * candidate, `defaultLabels.entitySingular`, lives on a different
 * registry AND defaults to the raw entity name, so it would not help.
 * An authored `@entityLabel` on the entity is the real fix.
 *
 * Type note: `FactorySignatureEntityField.type` is `SchemaFieldType` while
 * `EntityField` is a discriminated union. `signatureFieldToEntityField` maps
 * each variant faithfully.
 */
function entityFieldQuestions(
  call: FactoryCallSite,
  signature: FactorySignature,
): DomainQuestion[] {
  if (signature.entities.length === 0) return [];
  const entity = signature.entities[0];
  const entityName = call.params.entityName ?? entity.name;

  const candidateFields = entity.fields.map(signatureFieldToEntityField);
  const fieldCandidates: Record<string, EntityField> = {};
  const fieldDescriptions: Record<string, string> = {};
  const candidateNames: string[] = [];

  for (let i = 0; i < entity.fields.length; i++) {
    const sig = entity.fields[i];
    const ef = candidateFields[i];
    const name = sig.name;
    candidateNames.push(name);
    fieldCandidates[name] = ef;
    if (sig.description) {
      fieldDescriptions[name] = sig.description;
    }
  }

  const weight = tierWeight('domain');
  const q: DomainQuestion = {
    id: `${factoryCallPlanOrbitalName(call)}.__entityFields`,
    orbitalName: factoryCallPlanOrbitalName(call),
    question: `Fields for ${entityName}`,
    reason: `Defines the data model for ${entityName}. Pick the fields that matter for your use case.`,
    inputType: 'multiselect',
    mutationTemplate: {
      kind: 'set-orbital-entity-fields',
      orbitalName: factoryCallPlanOrbitalName(call),
    },
    suggestedAnswers: candidateNames,
    defaultValue: candidateNames,
    fieldCandidates,
    tier: 'domain',
    weight,
    priority: weight,
  };
  if (Object.keys(fieldDescriptions).length > 0) {
    q.fieldDescriptions = fieldDescriptions;
  }
  return [q];
}

/**
 * Map a `FactorySignatureEntityField` to an `EntityField` without unsafe casts.
 * Scalar types translate directly to `ScalarEntityField`. `array` and `object`
 * translate to their variants (no extra required fields). `enum` produces an
 * `EnumEntityField` when `values` is present, otherwise falls back to `string`.
 * `relation` produces a `RelationEntityField` when `relation` is present, otherwise
 * falls back to `string`.
 */
function signatureFieldToEntityField(f: FactorySignatureEntityField): EntityField {
  const base = {
    name: f.name,
    required: f.required,
    description: f.description,
    synonyms: f.synonyms,
    intrinsic: f.intrinsic,
  } as const;
  switch (f.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'date':
    case 'timestamp':
    case 'datetime':
    // Semantic string domains carry no dependent payload, so they pass through
    // as-is and the question widget narrows the input accordingly.
    case 'email':
    case 'url':
    case 'phone':
    case 'uuid':
    case 'image':
      return { ...base, type: f.type };
    case 'array':
      return { ...base, type: 'array' };
    case 'object':
      return { ...base, type: 'object' };
    case 'enum':
      if (Array.isArray(f.values) && f.values.length > 0) {
        return { ...base, type: 'enum', values: f.values };
      }
      // No values present — safe fallback; payload would be invalid without them.
      return { ...base, type: 'string' };
    case 'relation':
      if (f.relation !== undefined) {
        return { ...base, type: 'relation', relation: f.relation };
      }
      // No relation config present — safe fallback.
      return { ...base, type: 'string' };
    case 'node':
      // Renderable content is computed by the trait's effects, never asked
      // for in a questionnaire — no question payload beyond the tag.
      return { ...base, type: 'node' };
    case 'event':
      // Event-name reference (struct-alias member, e.g. `ItemAction.event`)
      // — authored by the trait, never asked for in a questionnaire, same
      // posture as `node`.
      return { ...base, type: 'event' };
    case 'money':
    case 'file':
    case 'bytes':
      // No type-dependent payload — same posture as the semantic string
      // domains above.
      return { ...base, type: f.type };
    default: {
      const _exhaustive: never = f.type;
      return { ...base, type: 'string' };
    }
  }
}

// ---------------------------------------------------------------------------
// Capability-driven questions
// ---------------------------------------------------------------------------

/**
 * Emit one yes/no question per unique capability not already covered by
 * the ruleOverlay. Capabilities whose name matches a `policy`-tier config
 * knob on the same trait are skipped — that knob already gives the user
 * a direct toggle for the governance behavior, so a second question adds
 * noise. Only capabilities with no backing policy knob get a question.
 *
 * The emitted question uses `inputType: 'boolean'` (a plain yes/no toggle)
 * with a plain-English prompt and `helpText` explaining what enabling it
 * does. The `set-rule` mutation template remains unchanged.
 */
function capabilityQuestions(
  call: FactoryCallSite,
  signature: FactorySignature,
  ruleCapabilities: ReadonlySet<string>,
): DomainQuestion[] {
  const entityName =
    call.params.entityName ?? signature.entities[0]?.name ?? factoryCallPlanOrbitalName(call);
  const seen = new Set<string>();
  const out: DomainQuestion[] = [];
  for (const trait of signature.traits) {
    const policyKnobKeys = new Set(
      trait.overridableConfigKeys
        .filter((p) => p.tier === 'policy')
        .map((p) => p.key),
    );
    for (const cap of trait.capabilities) {
      if (seen.has(cap)) continue;
      seen.add(cap);
      if (ruleCapabilities.has(cap)) continue;
      // Skip if a policy-tier knob on this trait already surfaces the toggle.
      if (policyKnobKeys.has(cap)) continue;
      out.push({
        id: `${factoryCallPlanOrbitalName(call)}.capability.${cap}`,
        orbitalName: factoryCallPlanOrbitalName(call),
        question: capabilityPrompt(cap, entityName),
        helpText: capabilityHelp(cap, trait),
        capability: cap,
        inputType: 'boolean',
        mutationTemplate: {
          kind: 'set-rule',
          capability: cap,
          appliesTo: [entityName],
        },
        // Capabilities encode governance/policy decisions — high impact.
        weight: 3,
        priority: 3,
      });
    }
  }
  return out;
}

/** Plain-English yes/no prompt for a capability toggle. */
function capabilityPrompt(capability: string, entity: string): string {
  const label = humanizeKey(capability);
  return `Enable ${label} for ${entity}?`;
}

/** How-to-answer help text for a capability question. */
function capabilityHelp(
  capability: string,
  trait: FactoryTraitSignature,
): string {
  return `Turns on the "${capability}" behavior from the ${trait.name} trait. Say yes to wire a governance rule into the schema.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSignature(
  catalog: ReadonlyArray<FactorySignature>,
  organism: string,
  orbital: string,
): FactorySignature | undefined {
  return catalog.find((s) => s.organism === organism && s.orbital === orbital);
}

function collectRuleCapabilities(
  overlay: RuleOverlay | undefined,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of overlay?.rules ?? []) {
    if (typeof r.capability === 'string') out.add(r.capability);
  }
  return out;
}

/** The plan's name for a call site's orbital — `orbitalName` when it differs from the catalog `orbital`. */
export function factoryCallPlanOrbitalName(call: FactoryCallSite): string {
  return call.orbitalName ?? call.orbital;
}
