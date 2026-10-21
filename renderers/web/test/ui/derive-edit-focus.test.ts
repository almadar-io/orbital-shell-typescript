/**
 * `withNodeTransition` regression: `OrbPreviewNode`'s click handler emits
 * `UI:ELEMENT_SELECTED` with a `focus` built by `deriveEditFocusFromElement`,
 * which reads `data-orb-transition` off the CLICKED element — not reliably
 * populated at L2, since the rendered content's own `transitionEvent` doesn't
 * always mirror the node's. A `focus` missing `transition` strands every
 * consumer that requires all of orbital/trait/transition (canvas delete via
 * `UI:DELETE_PATTERN`, the contextual-edit chat flow) — the click silently
 * dead-ends behind a "no pattern focused" warning. Each L2 `OrbPreviewNode`
 * renders exactly one transition, so its own `PreviewNodeData.transitionEvent`
 * is authoritative and should win regardless of what the DOM walk found.
 */
import { describe, it, expect } from 'vitest';
import type { EditFocus } from '@almadar/core';
import { deriveEditFocusFromElement, traitOfElement, withNodeTransition } from '../../src/lib/derive-edit-focus';

function baseFocus(overrides: Partial<EditFocus> = {}): EditFocus {
  return { level: 'node', orbital: 'Widgets', label: 'typography', ...overrides };
}

describe('withNodeTransition', () => {
  it('fills in transition when the DOM-derived focus has none', () => {
    const result = withNodeTransition(baseFocus(), { traitName: 'WidgetInteraction', transitionEvent: 'INIT' });
    expect(result.transition).toBe('INIT');
  });

  it('the node transition wins over a stale/mismatched DOM-derived one', () => {
    const result = withNodeTransition(baseFocus({ trait: 'WidgetInteraction', transition: 'STALE' }), { traitName: 'WidgetInteraction', transitionEvent: 'INIT' });
    expect(result.transition).toBe('INIT');
  });

  it('falls back to the DOM-derived transition when the node has none', () => {
    const result = withNodeTransition(baseFocus({ transition: 'FROM_DOM' }), { traitName: 'WidgetInteraction', transitionEvent: undefined });
    expect(result.transition).toBe('FROM_DOM');
  });

  it('leaves transition unset when neither source has one', () => {
    const result = withNodeTransition(baseFocus(), { traitName: 'WidgetInteraction', transitionEvent: undefined });
    expect(result.transition).toBeUndefined();
  });

  it('does not mutate other focus fields', () => {
    const focus = baseFocus({ trait: 'WidgetInteraction', path: 'root.children.0' });
    const result = withNodeTransition(focus, { traitName: 'WidgetInteraction', transitionEvent: 'INIT' });
    expect(result).toEqual({ ...focus, transition: 'INIT' });
  });

  it("an element drawn by an embedded trait keeps that trait's own transition", () => {
    const focus = baseFocus({ trait: 'CreateButton', transition: 'INIT', slot: 'main', path: 'root' });
    const result = withNodeTransition(focus, { traitName: 'NoteToolbar', transitionEvent: 'NOTES_LOADED' });
    expect(result).toEqual(focus);
  });
});


describe('deriveEditFocusFromElement — address attributes on an ancestor (live preview)', () => {
  it('reads trait / transition / slot from the nearest ancestor carrying them', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div data-orb-orbital="Widgets" data-orb-trait="WidgetInteraction" data-orb-transition="INIT" data-orb-slot="main" data-orb-path="root">
        <div data-pattern-path="root.children.1" data-pattern="typography"><p>Item B</p></div>
      </div>`;
    const el = host.querySelector('[data-pattern-path="root.children.1"]') as HTMLElement;
    expect(deriveEditFocusFromElement(el)).toMatchObject({
      orbital: 'Widgets', trait: 'WidgetInteraction', transition: 'INIT', slot: 'main', path: 'root.children.1', patternType: 'typography',
    });
  });
});

describe('traitOfElement', () => {
  it("a nested element's trait is its nearest ancestor's (a live render stamps the trait on the slot wrapper)", () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-orb-trait', 'Clicker');
    const child = document.createElement('div');
    child.setAttribute('data-pattern-path', 'root.children.0');
    wrapper.appendChild(child);
    expect(traitOfElement(child)).toBe('Clicker');
  });

  it("an element's own stamp wins over its ancestor's (an embedded trait's frame)", () => {
    const outer = document.createElement('div');
    outer.setAttribute('data-orb-trait', 'Toolbar');
    const inner = document.createElement('div');
    inner.setAttribute('data-orb-trait', 'SaveButton');
    outer.appendChild(inner);
    expect(traitOfElement(inner)).toBe('SaveButton');
  });

  it('no stamp anywhere: no trait', () => {
    expect(traitOfElement(document.createElement('div'))).toBeNull();
  });
});
