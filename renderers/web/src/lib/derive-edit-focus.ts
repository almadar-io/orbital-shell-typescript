import type { EditFocus } from '@almadar/core';

/**
 * Build an `EditFocus` from a clicked element's `data-orb-*` address (stamped by
 * UISlotRenderer). The owning orbital is read from the DOM (`data-orb-orbital`,
 * walking up via `closest` when the clicked node itself doesn't carry it); since
 * `EditFocus.orbital` is required, returns `null` when it can't be resolved.
 */
/** The trait that drew a rendered element: its own `data-orb-trait` / `data-source-trait`, or its nearest ancestor's. */
export function traitOfElement(el: Element): string | null {
  const traitEl = el.closest('[data-orb-trait],[data-source-trait]');
  return traitEl?.getAttribute('data-orb-trait') ?? traitEl?.getAttribute('data-source-trait') ?? null;
}

export function deriveEditFocusFromElement(el: HTMLElement): EditFocus | null {
  const orbitalEl = el.getAttribute('data-orb-orbital') !== null
    ? el
    : el.closest('[data-orb-orbital]');
  const orbital = orbitalEl?.getAttribute('data-orb-orbital') ?? '';
  if (!orbital) return null;

  const path = el.getAttribute('data-orb-path') ?? el.getAttribute('data-pattern-path');
  const patternType = el.getAttribute('data-orb-pattern') ?? el.getAttribute('data-pattern');
  // The element or its nearest ancestor carrying the attribute: in a live
  // preview the render's address (trait, transition, slot …) sits on the slot
  // wrapper, not on each nested element.
  const nearest = (attr: string): string | null => el.closest(`[${attr}]`)?.getAttribute(attr) ?? null;
  const trait = traitOfElement(el);
  const focus: EditFocus = {
    level: 'node',
    orbital,
    label: patternType ?? trait ?? el.tagName.toLowerCase(),
  };
  if (path !== null) focus.path = path;
  if (trait !== null) focus.trait = trait;
  if (patternType !== null) focus.patternType = patternType;
  const transition = nearest('data-orb-transition');
  if (transition !== null) focus.transition = transition;
  const state = nearest('data-orb-state');
  if (state !== null) focus.state = state;
  const slot = nearest('data-orb-slot');
  if (slot !== null) focus.slot = slot;
  const entity = nearest('data-orb-entity');
  if (entity !== null) focus.entity = entity;
  return focus;
}

/**
 * Fills `focus.transition` from the owning L2 node, whose one rendered
 * transition is authoritative for ITS trait (`data-orb-transition` isn't
 * stamped on every element). An element drawn by an embedded trait keeps
 * that trait's own transition — the node's belongs to a different trait.
 */
export function withNodeTransition(
  focus: EditFocus,
  node: { traitName?: string; transitionEvent?: string },
): EditFocus {
  const ownsElement = focus.trait === undefined || focus.trait === node.traitName;
  const transition = ownsElement ? node.transitionEvent ?? focus.transition : focus.transition;
  return transition ? { ...focus, transition } : { ...focus };
}
