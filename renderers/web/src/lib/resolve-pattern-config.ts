/**
 * Resolve the authored pattern config a canvas selection points at — the
 * render-ui node at `patternId` inside the selected transition (L2), or the
 * first match across the orbital's traits when only the orbital is known (L1).
 * Shared by the inspector and the canvas selection frame.
 */
import { navigatePatternPath, type Effect, type OrbitalDefinition, type OrbitalSchema, type PatternNode, type Trait, type Transition } from '@almadar/core';
import { renderUiEntriesOf } from '@almadar/core/patterns';
import { createLogger } from '@almadar/logger';

const inspectorLog = createLogger('almadar:ui:inspector');

/** Where a canvas selection points. */
export interface PatternSelectionAddress {
  orbitalName: string;
  traitName?: string;
  transitionEvent?: string;
  /** The trait the click reported (`data-source-trait`), searched first at L1. */
  sourceTrait?: string;
  /** `data-pattern-path` of the clicked node; the tree root when absent. */
  patternId?: string;
  patternType?: string;
}

export function findTransition(schema: OrbitalSchema, orbitalName: string, traitName: string, event: string): Transition | null {
  const orbital = (schema.orbitals ?? []).find((o: OrbitalDefinition) => o.name === orbitalName);
  if (!orbital) return null;
  const traits = (orbital.traits ?? []) as Trait[];
  const trait = traits.find(t => typeof t !== 'string' && t.name === traitName);
  if (!trait || typeof trait === 'string') return null;
  const sm = trait.stateMachine;
  if (!sm) return null;
  return (sm.transitions as Transition[])?.find(t => t.event === event) ?? null;
}




export function resolvePatternConfig(schema: OrbitalSchema, address: PatternSelectionAddress): PatternNode | null {
  const patternId = address.patternId ?? 'root';
  const transition = address.traitName && address.transitionEvent
    ? findTransition(schema, address.orbitalName, address.traitName, address.transitionEvent)
    : null;

  const tryEffects = (effects: Effect[]): PatternNode | null => {
    for (const { pattern: root } of renderUiEntriesOf(effects)) {
      const found = navigatePatternPath(root as PatternNode, patternId);
      if (!found) continue;
      // Type-discriminate so two transitions whose render-ui trees share
      // a path but differ in the node at that path don't silently swap.
      if (address.patternType
          && typeof found.type === 'string'
          && found.type !== address.patternType) {
        continue;
      }
      // Normalize nested → flat. Merge top-level keys over `props` so
      // `type` / `_id` / `children` survive the unwrap.
      const nested = found.props;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const { props: _stripped, ...rest } = found;
        void _stripped;
        return { ...(nested as PatternNode), ...rest };
      }
      return found;
    }
    return null;
  };

  // L2 fast path: the click came with a specific transition.
  if (transition) {
    const direct = tryEffects(transition.effects ?? []);
    if (direct) return direct;
  }

  // L1 fallback: widen to every transition in the orbital's traits.
  // Prefer the trait the click reported via `data-source-trait` so we
  // don't accidentally collide with another trait's identical render-ui
  // path (atoms reused across traits → same `root.children.0.…` path).
  const orbital = schema.orbitals.find((o) => o.name === address.orbitalName);
  if (orbital) {
    const orderedTraits = [...(orbital.traits ?? [])].sort((a, b) => {
      const aName = typeof a === 'string' ? a : a.name;
      const bName = typeof b === 'string' ? b : b.name;
      const src = address.sourceTrait;
      if (src && aName === src) return -1;
      if (src && bName === src) return 1;
      return 0;
    });
    for (const traitRef of orderedTraits) {
      if (typeof traitRef === 'string') continue;
      // Inline traits carry `stateMachine` directly; preprocessed ref
      // traits (`{ref, _resolved}`) carry it on `_resolved`. Read both.
      const inline = 'stateMachine' in traitRef ? traitRef.stateMachine : undefined;
      const resolved = '_resolved' in traitRef
        ? (traitRef as { _resolved?: Trait })._resolved?.stateMachine
        : undefined;
      const sm = inline ?? resolved;
      const traitTransitions = sm?.transitions;
      if (!Array.isArray(traitTransitions)) continue;
      for (const tx of traitTransitions) {
        const hit = tryEffects((tx as { effects?: Effect[] }).effects ?? []);
        if (hit) return hit;
      }
    }
  }

  // Selection has a patternId but nothing matched anywhere — usually a
  // path/key mismatch between the click target's `data-pattern-path`
  // and the SExpr tree shape. Surface it so future divergences don't
  // quietly render every prop as '—'.
  if (address.patternId) {
    inspectorLog.warn('pattern-config-unresolved', () => ({
      patternId: address.patternId,
      patternType: address.patternType,
      sourceTrait: address.sourceTrait,
      orbitalName: address.orbitalName,
      traitName: address.traitName,
      transitionEvent: address.transitionEvent,
    }));
  }
  return null;
}

/** The pattern node at `path` in a transition's render-ui tree, exactly as stored (copy/paste). */
export function patternNodeAt(schema: OrbitalSchema, orbitalName: string, traitName: string, event: string, path: string): PatternNode | null {
  const transition = findTransition(schema, orbitalName, traitName, event);
  if (!transition?.effects) return null;
  for (const { pattern: root } of renderUiEntriesOf(transition.effects)) {
    const found = navigatePatternPath(root as PatternNode, path);
    if (found) return found;
  }
  return null;
}

/** Clipboard type the canvas copies pattern nodes as. */
export const PATTERN_CLIPBOARD_TYPE = 'application/x-almadar-patterns';

/** Pattern nodes read back from the clipboard: a JSON array of objects with a string `type`, or null. */
export function parseClipboardPatterns(text: string): PatternNode[] | null {
  if (!text) return null;
  let value: PatternNode[] | { 'almadar/patterns'?: PatternNode[] };
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const nodes = Array.isArray(value) ? value : value?.['almadar/patterns'];
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  return nodes.every((n) => n !== null && typeof n === 'object' && typeof n.type === 'string') ? nodes : null;
}
