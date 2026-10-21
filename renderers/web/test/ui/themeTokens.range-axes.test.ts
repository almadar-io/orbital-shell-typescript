/**
 * themeTokens — range axes: heading voice, corner/border style, interactive
 * elevation and the surface axis. Twin of the Rust emitter tests in
 * `orbital-shell-typescript/src/codegen/theme/mod.rs` (`range_axes_*`); both
 * must emit the same var map for the same fixture.
 */

import { describe, it, expect } from 'vitest';
import type { ThemeTokens, ThemeVariant } from '@almadar/core';
import { themeTokensToCssVars } from '../../src/lib/themeTokens';

const RANGE_FIXTURE: ThemeTokens = {
  typeScale: {
    displayFamily: '"Limelight", serif',
    fontImport: 'https://fonts.googleapis.com/css2?family=Limelight&display=swap',
    headingWeight: '400',
    headingTransform: 'uppercase',
    headingTracking: '0.2em',
    headingStyle: 'italic',
    headingShadow: '0 0 6px currentColor',
  },
  geometry: {
    cornerShape: 'bevel',
    cornerShapePill: 'round',
    cornerShapeInteractive: 'round',
    borderStyle: 'double',
    borderStyleInteractive: 'outset',
  },
  elevation: {
    interactiveElevation: '2px 2px 0 #000',
    pressedElevation: 'inset 2px 2px 0 #000',
  },
  surface: {
    backdrop: 'blur(18px) saturate(1.6)',
    cardImage: 'linear-gradient(#fff6, #fff0)',
    pageImage: 'radial-gradient(#0002 1px, transparent 1px)',
    pageImageSize: '8px 8px',
  },
};

describe('themeTokensToCssVars — range axes', () => {
  it('emits the heading voice vars, and fontImport is NOT a CSS var', () => {
    const vars = themeTokensToCssVars({ typeScale: RANGE_FIXTURE.typeScale }, 'light');
    expect(vars).toEqual({
      '--font-family-display': '"Limelight", serif',
      '--heading-weight': '400',
      '--heading-transform': 'uppercase',
      '--heading-tracking': '0.2em',
      '--heading-style': 'italic',
      '--heading-shadow': '0 0 6px currentColor',
    });
  });

  it('emits corner shape + border style geometry vars', () => {
    expect(themeTokensToCssVars({ geometry: RANGE_FIXTURE.geometry }, 'light')).toEqual({
      '--corner-shape': 'bevel',
      '--corner-shape-pill': 'round',
      '--corner-shape-interactive': 'round',
      '--border-style': 'double',
      '--border-style-interactive': 'outset',
    });
  });

  it('emits interactive + pressed elevation', () => {
    expect(themeTokensToCssVars({ elevation: RANGE_FIXTURE.elevation }, 'light')).toEqual({
      '--elevation-interactive': '2px 2px 0 #000',
      '--elevation-pressed': 'inset 2px 2px 0 #000',
    });
  });

  it('emits the surface axis', () => {
    expect(themeTokensToCssVars({ surface: RANGE_FIXTURE.surface }, 'light')).toEqual({
      '--surface-backdrop': 'blur(18px) saturate(1.6)',
      '--surface-card-image': 'linear-gradient(#fff6, #fff0)',
      '--surface-page-image': 'radial-gradient(#0002 1px, transparent 1px)',
      '--surface-page-image-size': '8px 8px',
    });
  });

  it('dark variant surface replaces the base surface; absent dark surface falls back to base', () => {
    const dark: ThemeVariant = { surface: { backdrop: 'blur(4px)' } };
    expect(themeTokensToCssVars({ surface: RANGE_FIXTURE.surface }, 'dark', dark)).toEqual({
      '--surface-backdrop': 'blur(4px)',
    });
    expect(themeTokensToCssVars({ surface: RANGE_FIXTURE.surface }, 'dark', {})).toEqual(
      themeTokensToCssVars({ surface: RANGE_FIXTURE.surface }, 'light'),
    );
  });

  it('control: a theme without range axes emits none of their vars', () => {
    const vars = themeTokensToCssVars({ geometry: { radiusContainer: '8px' } }, 'light');
    expect(Object.keys(vars).filter((k) => /heading|corner|border-style|surface|elevation-(interactive|pressed)/.test(k))).toEqual([]);
  });

  it('empty-string values pass through (explicit reset), undefined is omitted', () => {
    expect(themeTokensToCssVars({ geometry: { borderStyle: '' } }, 'light')).toEqual({ '--border-style': '' });
  });

  it('emits motion shapes as the surface transform endpoints', () => {
    const vars = themeTokensToCssVars({ motion: { shapes: { modalEnter: 'scale(0.9)', pageEnter: 'none', toastEnter: 'translateX(24px)' } } }, 'light');
    expect(vars).toEqual({
      '--motion-modal-enter-from-transform': 'scale(0.9)',
      '--motion-toast-enter-from-transform': 'translateX(24px)',
      '--motion-page-enter-from-transform': 'none',
    });
  });

  it('control: motion without shapes emits no transform endpoints', () => {
    const vars = themeTokensToCssVars({ motion: { durations: { normal: '200ms' } } }, 'light');
    expect(Object.keys(vars).some((k) => k.startsWith('--motion-'))).toBe(false);
  });
});

describe('themeTokensToCssVars — element entry', () => {
  it('emits the theme default entry as its keyframe and the stagger step', () => {
    const vars = themeTokensToCssVars({ motion: { entry: { default: 'rise', stagger: '60ms' }, shapes: { enterRise: 'translateY(24px)' } } }, 'light');
    expect(vars['--motion-enter-default']).toBe('almadar-enter-rise');
    expect(vars['--motion-enter-stagger']).toBe('60ms');
    expect(vars['--motion-enter-rise-from-transform']).toBe('translateY(24px)');
  });
  it('emits the busy delay token', () => {
    expect(themeTokensToCssVars({ motion: { busyDelay: '500ms' } }, 'light')['--motion-busy-delay']).toBe('500ms');
  });
  it('a theme turning entry off emits none, not a keyframe name', () => {
    const vars = themeTokensToCssVars({ motion: { entry: { default: 'none' } } }, 'light');
    expect(vars['--motion-enter-default']).toBe('none');
  });
  it('control: motion without entry emits no entry vars', () => {
    const vars = themeTokensToCssVars({ motion: { durations: { fast: '100ms' } } }, 'light');
    expect(vars['--motion-enter-default']).toBeUndefined();
    expect(vars['--motion-enter-stagger']).toBeUndefined();
  });
});
