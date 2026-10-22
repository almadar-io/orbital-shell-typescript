/**
 * Parsed AST — LLM-emit relaxed views of the canonical orbital types.
 *
 * Every `Parsed*` type mirrors its canonical counterpart in this module
 * (`Trait`, `StateMachine`, `Transition`, `State`, `Event`, `OrbitalDefinition`,
 * `PageRefObject`, etc.) but loosens required fields to optional. The
 * loosening exists for one reason: the LLM can emit a partial orbital
 * (mid-stream, mid-tool-call, mid-LoLo lowering) and consumer code
 * needs to walk it WITHOUT casting to the strict canonical type before
 * every field access.
 *
 * Discipline:
 *
 * - **No `unknown`.** Every field has a concrete type, sourced from
 *   this same module where the type already exists (`EntityField`,
 *   `EntityPersistence`, `TraitCategory`, `TraitScope`, `SExpr`,
 *   `PageTraitRef`, `TraitEventContract`, `TraitEventListener`).
 *
 * - **No index signatures.** If the LLM emits a key the schema doesn't
 *   know about, the validator rejects it. The `Parsed*` types do not
 *   pretend to accept unknown keys at the type level.
 *
 * - **Required fields stay required.** `name` on `ParsedOrbital` is
 *   required because no orbital can exist without one. `name` /
 *   `linkedEntity` on `ParsedTrait` are required because the orbital
 *   compiler rejects traits missing either. Only fields the LLM
 *   legitimately omits during construction are optional.
 *
 * Use site: walkers that observe an orbital before it's fully
 * validated. Construct it as `ParsedOrbital`, narrow to
 * `OrbitalDefinition` after validation.
 *
 * @packageDocumentation
 */
import type { EntityField } from './field.js';
import type { EntityPersistence } from './entity.js';
import type { TraitCategory, TraitScope } from './trait.js';
import type { PageTraitRef } from './page.js';
import type { SExpr } from './expression.js';

/**
 * Top-level orbital as the LLM emits it. Relaxed view of
 * `OrbitalDefinition`: traits and pages may be partial, the domain
 * context + design hints may be missing.
 */
export interface ParsedOrbital {
  name: string;
  entity: ParsedEntity;
  traits: ParsedTrait[];
  pages: ParsedPage[];
  domainContext?: ParsedDomainContext;
  design?: ParsedDesign;
}

/**
 * Entity nucleus of an orbital. `name` + `fields` are required; the
 * factory canonical defaults can fill `persistence` and `collection`
 * when omitted.
 */
export interface ParsedEntity {
  name: string;
  fields: EntityField[];
  persistence?: EntityPersistence;
  collection?: string;
}

/**
 * One trait on an orbital. `name` + `linkedEntity` are required (the
 * compiler rejects either omission); state machine + scope + category
 * are filled by defaults when the LLM doesn't specify them.
 */
export interface ParsedTrait {
  name: string;
  linkedEntity: string;
  category?: TraitCategory;
  scope?: TraitScope;
  description?: string;
  config?: ParsedTraitConfig;
  emits?: ParsedEmitDeclaration[];
  listens?: ParsedListenDeclaration[];
  stateMachine?: ParsedStateMachine;
  capabilities?: string[];
}

/**
 * Trait `config { }` block — the LLM-emit shape carries each declared
 * config key as a typed value drawn from the JSON primitive set. A
 * stricter view (`DeclaredTraitConfig` in `trait.ts`) captures the
 * authored field descriptors with type+default+label+tier metadata;
 * `ParsedTraitConfig` is the in-flight value map.
 */
export type ParsedTraitConfig = {
  [key: string]: string | number | boolean | null | ReadonlyArray<string | number | boolean | null>;
};

/**
 * State-machine of a trait. Every field optional because the LLM may
 * emit the trait header before its body. A canonical
 * `StateMachine` (`state-machine.ts`) requires at least one state +
 * one transition.
 */
export interface ParsedStateMachine {
  states?: ParsedState[];
  events?: ParsedEvent[];
  transitions?: ParsedTransition[];
  initial?: string;
}

/**
 * One state of a `ParsedStateMachine`. Mirrors `State` from
 * `state-machine.ts` with name optional during construction.
 */
export interface ParsedState {
  name?: string;
  isInitial?: boolean;
}

/**
 * One event of a `ParsedStateMachine`. Mirrors `Event` from
 * `state-machine.ts`. `payloadSchema` is the canonical shape — an
 * array of `EntityField`s describing the event's payload.
 */
export interface ParsedEvent {
  key?: string;
  name?: string;
  payloadSchema?: EntityField[];
}

/**
 * One transition of a `ParsedStateMachine`. `effects` + `guard` use
 * `SExpr` from `expression.ts` — the canonical S-expression shape the
 * runtime evaluates.
 */
export interface ParsedTransition {
  from?: string;
  to?: string;
  event?: string;
  effects?: SExpr[];
  guard?: SExpr;
}

/**
 * Trait-emit declaration. Aliases `TraitEventContract` from
 * `trait.ts` with every field optional. The canonical contract
 * carries `event`, `scope`, `payload`; here all three are optional so
 * an in-flight emit (just the name, no payload yet) types correctly.
 */
export interface ParsedEmitDeclaration {
  event?: string;
  scope?: 'internal' | 'external';
  payload?: EntityField[];
}

/**
 * Trait-listen declaration. Mirrors `TraitEventListener` from
 * `trait.ts` with the source remap and trigger key optional.
 */
export interface ParsedListenDeclaration {
  event?: string;
  triggers?: string;
  scope?: 'internal' | 'external';
  payloadMapping?: { [key: string]: SExpr };
}

/**
 * One page entry on an orbital. Mirrors `PageRefObject` /
 * `OrbitalPage`; `path` is the URL, `name` is the canonical
 * identifier the molecule references.
 */
export interface ParsedPage {
  path?: string;
  name?: string;
  primaryEntity?: string;
  traits?: PageTraitRef[];
}

/**
 * Domain-context decorations the analyzer attaches to an orbital
 * (vocabulary, category, original request). Mirrors `DomainContext`
 * from `domain.ts` for the fields used in the parsed-AST surface; the
 * full `DomainContext` carries semantic-role overlays + custom-pattern
 * maps too, which the LLM doesn't emit in this surface.
 */
export interface ParsedDomainContext {
  request?: string;
  category?: string;
  vocabulary?: { [key: string]: string };
}

/**
 * Design hints (style + UX cues) the analyzer attaches. Mirrors
 * `DesignPreferences` from `domain.ts`.
 */
export interface ParsedDesign {
  style?: string;
  uxHints?: { [key: string]: string };
}

/**
 * Cross-reference alias to the canonical `OrbitalDefinition` shape
 * the validator produces after narrowing a `ParsedOrbital`. Importers
 * that want the strict shape import this directly:
 *
 * ```ts
 * import type { ValidatedOrbital } from '@almadar/core';
 * ```
 *
 * (Equivalent to `OrbitalDefinition`; the alias exists for code that
 * reads the validation pipeline top-down — `ParsedOrbital → ValidatedOrbital`.)
 */
export type { OrbitalDefinition as ValidatedOrbital } from './orbital.js';
