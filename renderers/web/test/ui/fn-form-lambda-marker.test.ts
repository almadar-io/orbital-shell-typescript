/**
 * fn-form-lambda × `$renderBinding` markers: the lambda conversion pass must
 * NEVER descend into a marker's `expression` — the S-expr there is evaluated
 * whole at render time, and compiling its inner `fn` nodes into React
 * render-props corrupts it (game canvas layers arrived as unpaintable React
 * elements / empty arrays — the ui-game organisms empty-board bug).
 */
import { describe, it, expect } from 'vitest';
import { RENDER_BINDING_MARKER, type RenderBindingMarker } from '@almadar/core';
import { convertFnFormLambdasInProps } from '../../src/lib/fn-form-lambda';
import type { SlotProps } from '../../src/providers/UISlotContext';

const marker = (expression: RenderBindingMarker['expression']): RenderBindingMarker => ({
  [RENDER_BINDING_MARKER]: true,
  expression,
});

describe('convertFnFormLambdasInProps × render-binding markers', () => {
  it('leaves fn nodes inside marker expressions untouched', () => {
    const fnNode = ['fn', 't', { position: { x: ['object/get', '@t', 'x'] }, type: 'draw-shape' }];
    const props: SlotProps = {
      drawables: [
        { type: 'draw-shape-layer', items: marker(['array/map', '@entity.tiles', fnNode]) },
      ],
    };
    const out = convertFnFormLambdasInProps(props);
    if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
    const layer = (out.drawables as Array<{ items: RenderBindingMarker }>)[0];
    expect(layer.items[RENDER_BINDING_MARKER]).toBe(true);
    const expr = layer.items.expression as unknown[];
    expect(expr[2]).toBe(fnNode); // same reference — not compiled into a render-prop
  });

  it('still converts real fn-form lambdas outside markers', () => {
    const props: SlotProps = {
      renderItem: ['fn', 'item', { type: 'typography', content: '@item.name' }],
    };
    const out = convertFnFormLambdasInProps(props);
    if (typeof out === 'string') throw new Error(`expected object props, got ${typeof out}`);
    expect(typeof out.renderItem).toBe('function');
  });
});

describe('convertFnFormLambdasInProps × i18n inside a lambda', () => {
  type ChildContent = { props: Record<string, unknown> };
  const childProps = (props: SlotProps): Record<string, unknown> => {
    const out = convertFnFormLambdasInProps(props);
    if (typeof out === 'string' || typeof out.renderItem !== 'function') throw new Error('expected a compiled renderItem');
    // The compiled lambda returns a Suspense boundary around the slot renderer for the child pattern.
    const el = (out.renderItem as (item: Record<string, unknown>, index: number) => { props: { children: { props: { content: ChildContent } } } })({ id: 'r1', key: 'todo' }, 0);
    return el.props.children.props.content.props;
  };

  it('defers an i18n/t call to render time instead of evaluating it without a locale', () => {
    const props = childProps({ renderItem: ['fn', 'col', { type: 'typography', content: ['i18n/t', 'site:board.todo'] }] });
    const content = props.content as RenderBindingMarker;
    expect(content[RENDER_BINDING_MARKER]).toBe(true);
    expect(content.expression).toEqual(['i18n/t', 'site:board.todo']);
  });

  it('defers an expression that reads @locale', () => {
    const props = childProps({ renderItem: ['fn', 'col', { type: 'typography', content: ['str/concat', '@locale', '-', '@col.key'] }] });
    expect((props.content as RenderBindingMarker)[RENDER_BINDING_MARKER]).toBe(true);
  });

  it('defers a conditional whose branch is a pattern carrying an i18n/t prop', () => {
    const branch = { type: 'button', label: ['i18n/t', 'feed:showAnswer'] };
    const props = childProps({ renderItem: ['fn', 'item', { type: 'box', children: [['if', ['==', '@item.key', 'todo'], branch, null]] }] });
    const child = (props.children as RenderBindingMarker[])[0];
    expect(child[RENDER_BINDING_MARKER]).toBe(true);
    expect(child.expression).toEqual(['if', true, branch, null]);
  });

  it('control: a conditional whose branches carry no i18n is still evaluated in place', () => {
    const branch = { type: 'button', label: 'Show' };
    const props = childProps({ renderItem: ['fn', 'item', { type: 'box', children: [['if', ['==', '@item.key', 'todo'], branch, null]] }] });
    expect((props.children as SlotProps[])[0]).toEqual(branch);
  });

  it('control: a plain operator call is still evaluated in place', () => {
    const props = childProps({ renderItem: ['fn', 'col', { type: 'typography', content: ['str/concat', 'col-', '@col.key'] }] });
    expect(props.content).toBe('col-todo');
  });
});
