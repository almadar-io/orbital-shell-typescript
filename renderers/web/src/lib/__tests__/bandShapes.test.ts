import { describe, expect, it } from 'vitest';
import { BAND_SHAPES, bandEdgeLayerStyle, bandPadding } from '../../core';

describe('bandShapes', () => {
  it('curve reads the theme mask and height', () => {
    const st = bandEdgeLayerStyle('curve', 'bottom', false, 'background');
    expect(st.maskImage).toBe('var(--surface-edge-mask, none)');
    expect(st.WebkitMaskImage).toBe(st.maskImage);
    expect(st.height).toContain('--surface-edge-height');
    expect(st.transform).toBeUndefined();
  });

  it('a named edge uses the built-in shape and a fixed height', () => {
    const st = bandEdgeLayerStyle('wave', 'bottom', false, 'background');
    expect(st.maskImage).toBe(BAND_SHAPES.wave);
    expect(st.maskImage).toContain('data:image/svg+xml');
    expect(st.height).toBe('clamp(24px, 6vw, 96px)');
  });

  it('turns the top edge and mirrors on flip', () => {
    expect(bandEdgeLayerStyle('tilt', 'top', false, 'muted').transform).toBe('rotate(180deg)');
    expect(bandEdgeLayerStyle('tilt', 'top', true, 'muted').transform).toBe('scaleY(-1)');
    expect(bandEdgeLayerStyle('tilt', 'bottom', true, 'muted').transform).toBe('scaleX(-1)');
  });

  it('fills the cut with the neighbour surface', () => {
    expect(bandEdgeLayerStyle('arc', 'bottom', false, 'muted').background).toBe('var(--color-muted)');
    expect(bandEdgeLayerStyle('arc', 'bottom', false, 'inverse').background).toBe('var(--color-foreground)');
    expect(bandEdgeLayerStyle('arc', 'bottom', false, 'gradient').background).toContain('--surface-accent-image');
  });

  it('paints a cut into a transparent neighbour with the page ground, fixed like .surface-page', () => {
    const st = bandEdgeLayerStyle('wave', 'bottom', false, 'background');
    expect(st.background).toBe('var(--surface-page-image, none), var(--color-background)');
    expect(st.backgroundAttachment).toBe('fixed');
    expect(st.backgroundSize).toContain('--surface-page-image-size');
    expect(bandEdgeLayerStyle('wave', 'bottom', false, 'muted').backgroundAttachment).toBeUndefined();
  });

  it('pads for the edge only when there is one', () => {
    expect(bandPadding('2rem', 'none')).toBeUndefined();
    expect(bandPadding('2rem', 'curve')).toBe('calc(2rem + var(--surface-edge-height, clamp(24px, 6vw, 96px)))');
    expect(bandPadding('0rem', 'scallop')).toBe('calc(0rem + clamp(24px, 6vw, 96px))');
  });
});
