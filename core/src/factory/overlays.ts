import type { TraitEventListener } from '../types/trait.js';
import type { FactoryParamValue } from './types.js';

/**
 * Cross-cutting presentation knobs that don't live per orbital
 * because they're factory-layer concerns (nav items live on a layout
 * trait; theme is a separate `ThemeRef`). The translator reads these
 * and threads them into the matching factory params.
 */
export interface PresentationOverlay {
  /** Nav items to add to the orbital's layout trait. The translator
   *  looks for a `signature.traits[i]` with `overridableConfigKeys`
   *  including `navItems` and writes into `traitOverrides[name].config.navItems`. */
  navAdditions?: ReadonlyArray<PresentationNavItem>;
  /** Optional theme ref override for the orbital. */
  themeRef?: string;
}

export interface PresentationNavItem {
  label: string;
  path: string;
  icon?: string;
}

/**
 * LLM-authored trait-level overrides keyed by trait name (matches
 * `signature.traits[].name`). Each entry's `config` keys are validated
 * against `signature.traits[i].overridableConfigKeys`.
 */
export type TraitOverlay = Readonly<Record<string, TraitOverlayEntry>>;

export interface TraitOverlayEntry {
  config?: Readonly<Record<string, FactoryParamValue>>;
  linkedEntity?: string;
  events?: Readonly<Record<string, string>>;
  name?: string;
  emitsScope?: 'internal' | 'external';
  listens?: ReadonlyArray<TraitEventListener>;
}

export type TraitOverlayListener = TraitEventListener;

/**
 * Rules carry a free-form `capability: string` that the translator
 * matches against `signature.traits[].capabilities` (source-tagged
 * in `.lolo`).
 */
export interface RuleOverlay {
  rules: ReadonlyArray<RuleOverlayEntry>;
  /** Entity-level ownership signal. The translator threads it into
   *  the matched trait's `config.ownerField` (when the matched trait
   *  advertises that key in `overridableConfigKeys`). */
  ownership?: ReadonlyArray<OwnershipOverlayEntry>;
}

export interface RuleOverlayEntry {
  id: string;
  /** Free-form capability label, matched against
   *  `signature.traits[].capabilities` by exact set membership. */
  capability: string;
  description: string;
  /** Entity names this rule binds to. Empty array = cross-cutting. */
  appliesTo: ReadonlyArray<string>;
  /** Optional role name (e.g. `"admin"`) when the rule is role-scoped. */
  role?: string;
  /** Optional extra config knobs threaded into the matched trait's
   *  `config`. Validated against the trait's `overridableConfigKeys`. */
  config?: Readonly<Record<string, FactoryParamValue>>;
}

export interface OwnershipOverlayEntry {
  /** Entity name (matches the orbital's bound entity name). */
  entity: string;
  /** Field name on the entity that carries the owner identifier. */
  ownerField: string;
}
