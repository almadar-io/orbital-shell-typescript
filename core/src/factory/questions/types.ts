/**
 * Typed questionnaire surface — shapes the studio renders + answers.
 *
 * Each `DomainQuestion` is one open slot derived deterministically from
 * a `FactoryCallSite` + its matching `FactorySignature`. The studio
 * renders the widget keyed off `inputType` (with optional structural
 * carriers `itemSchema` / `objectSchema` for complex types), and the
 * user's answer flows through `answersToMutations` into a typed
 * `FactoryCallPlanMutation`.
 *
 * Relocated from `@almadar-io/agent/analysis/questions/` — the
 * function is a pure transform over `@almadar/core` factory types
 * and belongs alongside them.
 *
 * @packageDocumentation
 */

import type { EntityField } from '../../types/field.js';
import type { EntityPersistence } from '../../types/entity.js';
import type { TraitReference } from '../../types/trait.js';
import type { FactoryConfigTier, FactoryParamValue } from '../types.js';

/**
 * One open slot in the questionnaire. The studio renders the question
 * + input widget keyed off `inputType` + `suggestedAnswers` (and, for
 * structured types, `itemSchema` / `objectSchema`); the answer fills
 * the matching `mutationTemplate`.
 *
 * ### Surfacing flag
 * `advanced` is `true` for questions whose tier is NOT `domain` or
 * `policy` (i.e. `infra`, `presentation`, untagged, or any non-canonical
 * value). The UI collapses advanced questions under a disclosure panel;
 * questions with `advanced` absent or `false` render inline.
 *
 * ### Entity-field multiselect
 * When `inputType` is `'multiselect'` and `mutationTemplate.kind` is
 * `'set-orbital-entity-fields'`, the answer is the subset of
 * `suggestedAnswers` the user checked. The UI maps selected names back
 * to `EntityField[]` via `fieldCandidates` (keyed by field name) before
 * submitting to `answersToMutations`. `fieldDescriptions` carries each
 * field's semantic description for the checkbox label.
 */
export interface DomainQuestion {
  /** Unique within a session. Keys the answer record. */
  id: string;
  /** Natural-language prompt shown to the user. */
  question: string;
  /**
   * One short sentence explaining WHY this question is being asked —
   * distinct from `helpText`. Never set to the same string as `helpText`.
   * Undefined when no distinct rationale exists.
   */
  reason?: string;
  /** Plan orbital this question scopes to (`FactoryCallSite.orbitalName`,
   *  else `FactoryCallSite.orbital`). */
  orbitalName: string;
  /** Free-form capability tag this question explores. Set when the
   *  question was emitted from a factory trait's `capabilities[]`
   *  advertisement (e.g. `'privacy'`, `'audit'`). Undefined for
   *  config-key-driven questions. */
  capability?: string;
  /** Drives the form widget. Matches a narrow type set the questionnaire
   *  UI knows how to render. */
  inputType: DomainQuestionInputType;
  /** Typed slot for the answer. `answersToMutations` switches on the
   *  template's `kind` to produce the matching
   *  `FactoryCallPlanMutation`. */
  mutationTemplate: FactoryCallPlanMutationTemplate;
  /** Canonical default value from the factory signature — the studio
   *  pre-fills the input, the user can confirm or override. */
  defaultValue?: DomainQuestionAnswer;
  /** Closed-enum or curated suggestions. Empty when the input is
   *  free-form. For entity-field multiselect this is the candidate
   *  field name list (see `fieldCandidates`). */
  suggestedAnswers?: ReadonlyArray<string>;
  /**
   * How-to-answer caption shown under the input widget. Set from
   * `FactoryConfigParam.description` (the knob's own authored caption).
   * Never set to the same text as `reason`.
   */
  helpText?: string;
  /** Per-element schema for array-of-objects (`listOfObjects`) and
   *  free-form chip lists (`tagList`). Propagated from
   *  `FactoryConfigParam.items`. */
  itemSchema?: EntityField;
  /** Per-property schema for structured objects (`objectForm`).
   *  Propagated from `FactoryConfigParam.properties`. */
  objectSchema?: Readonly<Record<string, EntityField>>;
  /** Decision-kind tier propagated from `FactoryConfigParam.tier`.
   *  Undefined when the source `.lolo` did not author an explicit
   *  `@tier` annotation — the studio treats undefined as
   *  `'presentation'`. */
  tier?: FactoryConfigTier;
  /**
   * `true` when this question is NOT a primary domain/policy decision —
   * i.e. `tier` is absent, `'infra'`, `'presentation'`, or any
   * non-canonical value. The UI collapses advanced questions under a
   * disclosure panel. Domain and policy questions always have
   * `advanced` absent (falsy).
   */
  advanced?: boolean;
  /** Impact weight derived from `tier` (policy/domain high, infra medium,
   *  presentation low). Drives the studio's Confidence score — answering a
   *  high-weight question moves the needle more. */
  weight?: number;
  /** Ordering rank for the prescient-first wizard. Seeded from `weight`
   *  (deterministic); the studio server may boost it by prompt relevance.
   *  Higher = surfaced earlier. */
  priority?: number;
  /**
   * Full `EntityField` candidates keyed by field name. Present only on
   * entity-field multiselect questions (`inputType: 'multiselect'`,
   * `mutationTemplate.kind: 'set-orbital-entity-fields'`). The UI maps
   * the user's selected field names back to `EntityField[]` via this
   * record before calling `answersToMutations`.
   */
  fieldCandidates?: Readonly<Record<string, EntityField>>;
  /**
   * Human-readable description for each candidate field name. Keyed by
   * field name (same keys as `fieldCandidates`). The UI shows this as
   * the checkbox sublabel.
   */
  fieldDescriptions?: Readonly<Record<string, string>>;
}

/**
 * Narrow set of widget kinds the studio renders.
 *
 * The derivation in `generate.ts:deriveInputType` reads structural
 * metadata (`param.items.properties`, `param.properties`,
 * `param.enumValues`) on top of `param.type` so authors can ship a
 * `[NavItem]` field and have the studio render a per-element form,
 * not a JSON textarea.
 */
export type DomainQuestionInputType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'persistence'
  | 'capability'
  | 'multiselect'    // string[] with enumValues (closed set)
  | 'tagList'        // string[] without enumValues (free-form chips)
  | 'fieldList'      // EntityField[]
  | 'urlPath'
  | 'listOfObjects'  // [Struct] — widget reads question.itemSchema
  | 'objectForm';    // structured object — widget reads question.objectSchema

/**
 * One variant per `FactoryCallPlanMutation.kind` the questionnaire
 * surface supports. Each variant carries the discriminant pieces of
 * the target mutation that are known at question-generation time
 * (e.g. the orbital we're editing). The answer fills the remaining
 * value in `answersToMutations`.
 */
export type FactoryCallPlanMutationTemplate =
  | { kind: 'set-orbital-entity-name'; orbitalName: string }
  | { kind: 'set-orbital-entity-fields'; orbitalName: string }
  | { kind: 'set-orbital-persistence'; orbitalName: string }
  | { kind: 'set-orbital-collection'; orbitalName: string }
  | { kind: 'set-orbital-page-path'; orbitalName: string; pageName: string }
  | {
      kind: 'set-trait-override-config';
      orbitalName: string;
      traitName: string;
      configKey: string;
    }
  | { kind: 'add-extra-trait'; orbitalName: string }
  | { kind: 'remove-extra-trait'; orbitalName: string }
  | {
      kind: 'set-rule';
      capability: string;
      appliesTo: ReadonlyArray<string>;
    }
  | { kind: 'remove-rule'; ruleId: string };

/**
 * Typed answer shape. The studio coerces the input into one of these
 * before submitting. `answersToMutations` narrows on the matching
 * `mutationTemplate.kind`.
 *
 * `null` means "answer skipped" (UI honours, reducer emits no
 * mutation).
 */
export type DomainQuestionAnswer =
  | string
  | EntityPersistence
  | ReadonlyArray<EntityField>
  | TraitReference
  | FactoryParamValue
  | null;

/**
 * The shape passed to `answersToMutations` — keyed by
 * `DomainQuestion.id`. Questions the user skipped MAY be omitted
 * entirely OR carry `null`; both behave the same downstream.
 */
export type DomainQuestionAnswers = Readonly<
  Record<string, DomainQuestionAnswer>
>;

// Re-export the param value type so consumers don't need a separate
// import path for the closed scalar union.
export type { FactoryParamValue };
