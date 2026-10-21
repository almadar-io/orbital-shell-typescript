/**
 * themeTokens — drawing axes: `diagram` (how canvas marks are drawn), `scene` (3D material and
 * light) and the `surface.diagram` canvas ground. Twin of the Rust emitter tests in
 * `orbital-shell-typescript/src/codegen/theme/mod.rs` (`diagram_axes_*`); both must emit the
 * same var map for the same fixture.
 */

import { describe, it, expect } from 'vitest';
import type { ThemeTokens, ThemeVariant } from '@almadar/core';
import { themeTokensToCssVars } from '../../src/lib/themeTokens';

const DIAGRAM_FIXTURE: ThemeTokens = {
  diagram: {
    strokeThin: '1px',
    strokeNormal: '2px',
    strokeBold: '4px',
    lineCap: 'square',
    lineJoin: 'miter',
    dash: '8 4',
    dot: '1 4',
    fillStyle: 'outline',
    fillOpacity: '0.25',
    roughness: '1.5',
    glow: '6',
    shadow: '2px 2px 0 #000',
    marker: 'open',
    labelFont: 'mono',
    labelSize: 'sm',
    labelWeight: '600',
    labelCase: 'uppercase',
    corner: '0px',
  },
  scene: {
    materialRoughness: '0.8',
    materialMetalness: '0.1',
    materialFlat: '1',
    materialOutline: '2',
    lightAmbient: '0.6',
    lightKey: '1.2',
    lightKeyColor: '#fff4e0',
    fog: '0.2',
  },
  surface: { diagram: 'var(--color-card)' },
};

describe('themeTokensToCssVars — drawing axes', () => {
  it('emits every diagram var', () => {
    expect(themeTokensToCssVars({ diagram: DIAGRAM_FIXTURE.diagram }, 'light')).toEqual({
      '--diagram-stroke-thin': '1px',
      '--diagram-stroke-normal': '2px',
      '--diagram-stroke-bold': '4px',
      '--diagram-line-cap': 'square',
      '--diagram-line-join': 'miter',
      '--diagram-dash': '8 4',
      '--diagram-dot': '1 4',
      '--diagram-fill-style': 'outline',
      '--diagram-fill-opacity': '0.25',
      '--diagram-roughness': '1.5',
      '--diagram-glow': '6',
      '--diagram-shadow': '2px 2px 0 #000',
      '--diagram-marker': 'open',
      '--diagram-label-font': 'mono',
      '--diagram-label-size': 'sm',
      '--diagram-label-weight': '600',
      '--diagram-label-case': 'uppercase',
      '--diagram-corner': '0px',
    });
  });

  it('emits every scene var', () => {
    expect(themeTokensToCssVars({ scene: DIAGRAM_FIXTURE.scene }, 'light')).toEqual({
      '--material-roughness': '0.8',
      '--material-metalness': '0.1',
      '--material-flat': '1',
      '--material-outline': '2',
      '--light-ambient': '0.6',
      '--light-key': '1.2',
      '--light-key-color': '#fff4e0',
      '--scene-fog': '0.2',
    });
  });

  it('emits the canvas ground beside the other surface vars', () => {
    expect(themeTokensToCssVars({ surface: { diagram: 'var(--color-card)', backdrop: 'blur(4px)' } }, 'light')).toEqual({
      '--surface-backdrop': 'blur(4px)',
      '--surface-diagram': 'var(--color-card)',
    });
  });

  it('control: a theme without the drawing axes emits none of their vars', () => {
    const vars = themeTokensToCssVars({ geometry: { cornerShape: 'round' } }, 'light');
    expect(Object.keys(vars).filter((k) => k.startsWith('--diagram-') || k.startsWith('--material-') || k.startsWith('--light-') || k === '--scene-fog' || k === '--surface-diagram')).toEqual([]);
  });

  it('edge: a partial diagram axis emits only the keys it sets', () => {
    expect(themeTokensToCssVars({ diagram: { glow: '8' } }, 'light')).toEqual({ '--diagram-glow': '8' });
  });

  it('edge: the dark variant replaces the whole axis, as every typed axis does', () => {
    const dark: ThemeVariant = { diagram: { glow: '10' }, scene: { lightAmbient: '0.3' } };
    const vars = themeTokensToCssVars(DIAGRAM_FIXTURE, 'dark', dark);
    expect(vars['--diagram-glow']).toBe('10');
    expect(vars['--diagram-stroke-normal']).toBeUndefined();
    expect(vars['--light-ambient']).toBe('0.3');
    expect(vars['--material-roughness']).toBeUndefined();
    expect(vars['--surface-diagram']).toBe('var(--color-card)');
  });

  it('series and diagram colors ride the colors map as --color-*', () => {
    const vars = themeTokensToCssVars({ colors: { 'series-1': '#123456', 'diagram-ink': '#000' } }, 'light');
    expect(vars['--color-series-1']).toBe('#123456');
    expect(vars['--color-diagram-ink']).toBe('#000');
  });
});
