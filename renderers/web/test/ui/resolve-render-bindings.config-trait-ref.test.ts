/**
 * A `@trait.X` child forwarded through `@config` (std-hero's `mediaContent`)
 * reaches the renderer as the authored string, so the renderer can embed it.
 */
import { describe, it, expect } from 'vitest';
import { RENDER_BINDING_MARKER, type RenderBindingMarker } from '@almadar/core';
import { resolveRenderBindingMarkers } from '../../src/lib/resolve-render-bindings';

const marker = (expression: RenderBindingMarker['expression']): RenderBindingMarker => ({
  [RENDER_BINDING_MARKER]: true,
  expression,
});

function body(expression: RenderBindingMarker['expression'], config: Record<string, RenderBindingMarker['expression']>): string {
  const out = resolveRenderBindingMarkers({ body: marker(expression) }, 'Hero', {}, { mediaContent: config.mediaContent }, 'idle');
  if (typeof out === 'string') throw new Error('expected props');
  return JSON.stringify(out.body);
}

describe('config-forwarded @trait refs survive marker evaluation', () => {
  const media = { type: 'box', children: ['@trait.HeroArt'] };

  it('an if choosing @config.mediaContent keeps the @trait string', () => {
    expect(body(['if', ['==', '', ''], '@config.mediaContent', { type: 'box', children: [] }], { mediaContent: media })).toBe(JSON.stringify(media));
  });

  it('an if choosing the inlined node keeps the @trait string', () => {
    expect(body(['if', ['==', '', ''], media, { type: 'box', children: [] }], { mediaContent: media })).toBe(JSON.stringify(media));
  });
});
