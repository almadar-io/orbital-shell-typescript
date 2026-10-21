/**
 * resolveRenderBindingMarkers — render-time evaluation of `$renderBinding`
 * prop leaves against the source trait's live bindings. Pins:
 * - markers resolve to the current entity values (the live-update half of
 *   the eager-flush-eval fix),
 * - identity preservation: no markers → the ORIGINAL props reference is
 *   returned (Form's normalizedInitialData contract),
 * - foreign `_sourceTrait` subtrees (multi-source slot stacks) stay raw so
 *   the child's own renderer resolves them against ITS trait,
 * - markers in array position that evaluate to arrays splice flat
 *   (`array/map` children expressions).
 */
import { describe, it, expect } from 'vitest';
import { RENDER_BINDING_MARKER, type RenderBindingMarker } from '@almadar/core';
import { resolveRenderBindingMarkers } from '../../src/lib/resolve-render-bindings';
import type { SlotProps, SlotPropValue } from '../../src/providers/UISlotContext';

const marker = (expression: RenderBindingMarker['expression']): RenderBindingMarker => ({
  [RENDER_BINDING_MARKER]: true,
  expression,
});

describe('resolveRenderBindingMarkers', () => {
  it('resolves pure and embedded entity bindings against the live row', () => {
    const props: SlotProps = {
      content: marker('HP: @entity.hp / @entity.maxHp'),
      value: marker('@entity.hp'),
    };
    const out = resolveRenderBindingMarkers(props, 'Hero', { hp: 7, maxHp: 12 }, undefined, 'playing');
    if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
    expect(out.content).toBe('HP: 7 / 12');
    expect(out.value).toBe(7);
  });

  it('evaluates s-expression markers with config in scope', () => {
    const props: SlotProps = {
      content: marker(['str/concat', 'Round ', '@entity.round', ' of ', '@config.maxRounds']),
    };
    const out = resolveRenderBindingMarkers(
      props,
      'Board',
      { round: 3 },
      { maxRounds: 9 },
      'playing',
    );
    if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
    expect(out.content).toBe('Round 3 of 9');
  });

  it('resolves a new container that reuses already-resolved markers (same entity)', () => {
    // A re-flush rebuilds the containers but the reconciler keeps the SAME
    // marker objects; the entity did not change, so every marker is a cache
    // hit. The walk used to report that as "unchanged" and hand back the NEW
    // container with its raw markers (`t.slice is not a function` in
    // DialogueBubble on ui-visual-novel-board's typewriter tick).
    const entity = { text: 'hello', n: 2 };
    const text = marker('@entity.text');
    const n = marker('@entity.n');
    const first = resolveRenderBindingMarkers({ children: [{ type: 'dialogue-bubble', text, revealedChars: n, position: 'bottom' }] }, 'VN', entity, undefined, 'playing');
    const second = resolveRenderBindingMarkers({ children: [{ type: 'dialogue-bubble', text, revealedChars: n, position: 'top' }] }, 'VN', entity, undefined, 'playing');
    for (const out of [first, second]) {
      if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
      const child = (out.children as ReadonlyArray<Record<string, SlotPropValue>>)[0];
      expect(child.text).toBe('hello');
      expect(child.revealedChars).toBe(2);
    }
  });

  it('keeps the resolved container identity across renders with unchanged inputs', () => {
    const entity = { text: 'hello' };
    const props: SlotProps = { children: [{ type: 'dialogue-bubble', text: marker('@entity.text') }] };
    const a = resolveRenderBindingMarkers(props, 'VN', entity, undefined, 'playing');
    const b = resolveRenderBindingMarkers(props, 'VN', entity, undefined, 'playing');
    expect(b).toBe(a);
    expect(a).not.toBe(props);
  });

  it('returns the original props reference when no markers are present', () => {
    const props: SlotProps = { content: 'static', items: [1, 2, 3] };
    expect(resolveRenderBindingMarkers(props, 'Hero', { hp: 7 }, undefined, '')).toBe(props);
  });

  it('leaves foreign _sourceTrait subtrees raw for their own renderer', () => {
    const foreign: SlotPropValue = {
      type: 'typography',
      content: marker('@entity.turn'),
      _sourceTrait: 'SideTurn',
    };
    const props: SlotProps = { children: [foreign] };
    const out = resolveRenderBindingMarkers(props, '__multi_source_stack__', {}, undefined, '');
    if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
    const child = (out.children as readonly Record<string, SlotPropValue>[])[0];
    expect(child.content).toBe(foreign && (foreign as Record<string, SlotPropValue>).content);
  });

  it('resolves same-trait nested children', () => {
    const props: SlotProps = {
      children: [{ type: 'typography', content: marker('@entity.turn') }],
    };
    const out = resolveRenderBindingMarkers(props, 'SideTurn', { turn: 4 }, undefined, '');
    if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
    const child = (out.children as readonly Record<string, SlotPropValue>[])[0];
    expect(child.content).toBe(4);
  });

  it('splices markers that evaluate to arrays flat into array position', () => {
    const props: SlotProps = {
      children: [
        { type: 'typography', content: 'head' },
        marker('@entity.entries'),
      ],
    };
    const out = resolveRenderBindingMarkers(
      props,
      'SideChronicle',
      { entries: [{ type: 'typography', content: 'a' }, { type: 'typography', content: 'b' }] },
      undefined,
      '',
    );
    if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
    const children = out.children as readonly Record<string, SlotPropValue>[];
    expect(children).toHaveLength(3);
    expect(children[1].content).toBe('a');
    expect(children[2].content).toBe('b');
  });

  it('memoizes per (marker, entity, config, state): repeat inputs return the same resolved container', () => {
    const m = marker('@entity.hp');
    const props: SlotProps = { value: m, other: 'static' };
    const entity = { hp: 7 };
    const first = resolveRenderBindingMarkers(props, 'Hero', entity, undefined, 'playing');
    if (typeof first === 'string') throw new Error(`expected object props, got ${typeof first}`);
    expect(first.value).toBe(7);
    expect(first).not.toBe(props);
    // Repeat inputs return the SAME resolved object — a stable identity for
    // downstream memos, never the raw props with their markers.
    const second = resolveRenderBindingMarkers(props, 'Hero', entity, undefined, 'playing');
    expect(second).toBe(first);
  });

  it('a new entity snapshot re-resolves (cache keyed on snapshot identity)', () => {
    const m = marker('@entity.hp');
    const props: SlotProps = { value: m };
    const first = resolveRenderBindingMarkers(props, 'Hero', { hp: 7 }, undefined, 'playing');
    const second = resolveRenderBindingMarkers(props, 'Hero', { hp: 9 }, undefined, 'playing');
    if (typeof second === 'string') throw new Error(`expected object props, got ${typeof second}`);
    expect(second.value).toBe(9);
    expect(second).not.toBe(first);
  });

  it('state changes re-resolve even with the same entity snapshot', () => {
    const m = marker('@entity.hp');
    const props: SlotProps = { value: m };
    const entity = { hp: 7 };
    const a = resolveRenderBindingMarkers(props, 'Hero', entity, undefined, 'playing');
    const b = resolveRenderBindingMarkers(props, 'Hero', entity, undefined, 'dead');
    expect(b).not.toBe(props);
    expect(b).not.toBe(a);
  });
});

describe('resolveRenderBindingMarkers — i18n/t in a deferred expression', () => {
  const props = (): SlotProps => ({ content: marker(['i18n/t', 'site:posts.count', { n: '@entity.count' }]) });
  const en = { locale: 'en', messages: { 'site:posts.count': '{{n}} posts' } };
  const ar = { locale: 'ar', messages: { 'site:posts.count': '{{n}} منشورات' } };

  it('evaluates with the viewer\'s locale and catalog', () => {
    const out = resolveRenderBindingMarkers(props(), 'Blog', { count: 3 }, undefined, 'idle', ar);
    if (typeof out === 'string') throw new Error('expected object props');
    expect(out.content).toBe('3 منشورات');
  });

  it('edge: the same props under another locale re-resolve instead of hitting the cache', () => {
    const shared = props();
    const entity = { count: 2 };
    const first = resolveRenderBindingMarkers(shared, 'Blog', entity, undefined, 'idle', en);
    const second = resolveRenderBindingMarkers(shared, 'Blog', entity, undefined, 'idle', ar);
    if (typeof first === 'string' || typeof second === 'string') throw new Error('expected object props');
    expect(first.content).toBe('2 posts');
    expect(second.content).toBe('2 منشورات');
  });

  it('control: without a catalog the evaluator reports the missing message', () => {
    expect(() => resolveRenderBindingMarkers(props(), 'Blog', { count: 1 }, undefined, 'idle')).toThrow('message for `site:posts.count`');
  });
});
