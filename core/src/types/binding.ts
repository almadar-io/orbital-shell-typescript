/**
 * Binding root classification
 *
 * The prefix of an `@X.path` binding expression identifies which runtime
 * context resolves the rest of the path. This type is the TS-side mirror
 * of `OirBindingRoot` in `orbital-core`'s IR; publishing it from
 * `@almadar/core` lets the codegen, the runtime binding resolver, and
 * the verifier's schema walker all refer to the same narrow union.
 *
 * Distinct from {@link ParsedBinding.root} (which is a plain string): use
 * `BindingRoot` whenever you need exhaustiveness over the known prefixes.
 *
 * - `entity`: `@entity.field` — the trait's linked entity (first row on
 *   the client, `getById` result on the server).
 * - `payload`: `@payload.x` — the last event's payload.
 * - `state`: `@state.x` — the state machine's `state` slot (rare;
 *   mostly used for guard/effect contexts).
 * - `config`: `@config.x` — the trait ref's merged config from the
 *   molecule call site.
 * - `user`: `@user.x` — authenticated user / agent context.
 * - `trait`: `@trait.x` — render-time reference to another trait's
 *   mounted view. Resolved by `<TraitFrame>` at runtime, not by the
 *   SExpression compiler.
 * - `now`: `@now` — the dispatch's one timestamp (Runtime Spec Clause 8.5).
 * - `callsitePayload`: `@callsitePayload.x` — a composing transition's
 *   payload captured for an inlined child trait (compiler-produced).
 * - `pages` / `currentTheme`: render-resolved schema sigils (no path).
 * - `event`, `prevEvents`, `prevStates`, `fromState`, `toState`: the delivery
 *   being processed and this dispatch's log (Runtime Spec Clause 5.5).
 * - `other`: not a root — a lambda/let local (`@item`) or an
 *   entity-reference binding (`@User.name`).
 *
 * The author-facing roots are the i18n `sigils` table; the orbital-compiler
 * validator's `CORE_BINDING_ROOTS` is the same set as `BINDING_ROOTS` minus `other`.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { RuntimeValue } from './json.js';

export type BindingRoot =
  | 'entity'
  | 'payload'
  | 'state'
  | 'now'
  | 'config'
  | 'trait'
  | 'user'
  | 'callsitePayload'
  | 'pages'
  | 'currentTheme'
  | 'locale'
  | 'event'
  | 'prevEvents'
  | 'prevStates'
  | 'fromState'
  | 'toState'
  | 'fromEntity'
  | 'other';

/** Every known binding root, in a stable order — useful for exhaustiveness checks. */
export const BINDING_ROOTS: readonly BindingRoot[] = [
  'entity',
  'payload',
  'state',
  'now',
  'config',
  'trait',
  'user',
  'callsitePayload',
  'pages',
  'currentTheme',
  'locale',
  'event',
  'prevEvents',
  'prevStates',
  'fromState',
  'toState',
  'fromEntity',
  'other',
] as const;

const KNOWN_ROOTS = new Set<string>(BINDING_ROOTS.filter((r) => r !== 'other'));

/**
 * Narrow a raw binding-root string (e.g. the `root` field of
 * `ParsedBinding` from `./expression.ts`) to a `BindingRoot`. Returns
 * `'other'` for entity-reference roots like `@User.name` or unknown
 * prefixes.
 */
export function toBindingRoot(root: string): BindingRoot {
  return KNOWN_ROOTS.has(root) ? (root as BindingRoot) : 'other';
}

/**
 * A trait reference string of the form `@trait.<TraitName>`. Used as the
 * value type for `trait`-typed config fields. The runtime + compiled codegen
 * both substitute this with embedded trait UI at render time.
 *
 * Branded as a literal-template type so TS narrows on use; consumers should
 * call {@link isTraitFieldRef} to validate runtime values before assignment.
 */
export type TraitFieldRef = `@trait.${string}`;

const TRAIT_REF_PATTERN = /^@trait\.[A-Z][a-zA-Z0-9]*$/;

/** Type guard: narrow an unknown value to {@link TraitFieldRef}. */
export function isTraitFieldRef(value: RuntimeValue): value is TraitFieldRef {
  return typeof value === 'string' && TRAIT_REF_PATTERN.test(value);
}

/** Zod schema for {@link TraitFieldRef} values. Useful when validating analyzer
 *  JSON or recipe overrides at runtime boundaries. */
export const TraitFieldRefSchema = z
  .string()
  .regex(TRAIT_REF_PATTERN, 'expected `@trait.<TraitName>` reference');
