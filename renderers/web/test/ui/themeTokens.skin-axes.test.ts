/**
 * themeTokens — skin axes (Layer 1) emission tests.
 *
 * These tests pin the JS runtime mirror's emission for the new typed axes
 * (DensityTokens, TypeScaleTokens, MotionTokens, IconographyTokens,
 * ElevationTokens, GeometryTokens). The Rust compiler's emission lives in
 * `orbital-rust/crates/orbital-shell-typescript/src/codegen/theme.rs` —
 * `emit_skin_axes` / `emit_skin_axes_dark` — and MUST produce the same
 * CSS-variable map for the same input fixture. See `docs/Almadar_Std_Variations.md`
 * §2 and `packages/almadar-ui/themes/_contract.md` for the contract.
 *
 * When the contract evolves: update this test AND the Rust emitters together.
 * A failing test here likely means runtime/compile divergence — the explicit
 * thing this layer exists to prevent (see `CLAUDE.md` §6 "Definition of done:
 * BOTH verifiers must pass").
 */

import { describe, it, expect } from 'vitest';
import type {
  DensityTokens,
  ElevationTokens,
  GeometryTokens,
  IconographyTokens,
  MotionTokens,
  ThemeTokens,
  ThemeVariant,
  TypeScaleTokens,
} from '@almadar/core';
import { themeTokensToCssVars } from '../../src/lib/themeTokens';

describe('themeTokensToCssVars — Density axis', () => {
  it('emits --space-N for each populated spacing step', () => {
    const density: DensityTokens = {
      spacing: { space0: '0px', space3: '12px', space12: '48px' },
    };
    const vars = themeTokensToCssVars({ density }, 'light');
    expect(vars).toEqual({
      '--space-0': '0px',
      '--space-3': '12px',
      '--space-12': '48px',
    });
  });

  it('emits per-element height tokens', () => {
    const density: DensityTokens = {
      buttonHeightMd: '36px',
      inputHeightLg: '44px',
      rowHeightCompact: '32px',
    };
    expect(themeTokensToCssVars({ density }, 'light')).toEqual({
      '--button-height-md': '36px',
      '--input-height-lg': '44px',
      '--row-height-compact': '32px',
    });
  });

  it('emits per-element padding tokens', () => {
    const density: DensityTokens = {
      cardPaddingMd: '16px',
      dialogPadding: '24px',
      sectionGap: '32px',
    };
    expect(themeTokensToCssVars({ density }, 'light')).toEqual({
      '--card-padding-md': '16px',
      '--dialog-padding': '24px',
      '--section-gap': '32px',
    });
  });

  it('omits undefined density fields entirely', () => {
    const density: DensityTokens = { spacing: { space3: '12px' } };
    const vars = themeTokensToCssVars({ density }, 'light');
    expect(Object.keys(vars)).toEqual(['--space-3']);
  });
});

describe('themeTokensToCssVars — TypeScale axis', () => {
  it('emits family triplet tokens', () => {
    const typeScale: TypeScaleTokens = {
      displayFamily: '"Fraunces", serif',
      bodyFamily: '"Inter", sans-serif',
      monoFamily: '"JetBrains Mono", monospace',
    };
    expect(themeTokensToCssVars({ typeScale }, 'light')).toEqual({
      '--font-family-display': '"Fraunces", serif',
      '--font-family-body': '"Inter", sans-serif',
      '--font-family-mono': '"JetBrains Mono", monospace',
    });
  });

  it('emits each populated scale entry as paired --text-N / --leading-N', () => {
    const typeScale: TypeScaleTokens = {
      scale: {
        sm: { size: '14px', lineHeight: '20px' },
        '2xl': { size: '24px', lineHeight: '32px' },
        'display-1': { size: '48px', lineHeight: '52px' },
      },
    };
    expect(themeTokensToCssVars({ typeScale }, 'light')).toEqual({
      '--text-sm': '14px',
      '--leading-sm': '20px',
      '--text-2xl': '24px',
      '--leading-2xl': '32px',
      '--text-display-1': '48px',
      '--leading-display-1': '52px',
    });
  });

  it('emits intent mappings with var(--text-*) / var(--font-weight-*) / var(--leading-*) resolution', () => {
    const typeScale: TypeScaleTokens = {
      intents: {
        headingMajor: { slot: 'display', size: '2xl', weight: 'bold' },
        caption: { slot: 'body', size: 'xs', weight: 'normal' },
      },
    };
    expect(themeTokensToCssVars({ typeScale }, 'light')).toEqual({
      '--intent-heading-major-size': 'var(--text-2xl)',
      '--intent-heading-major-weight': 'var(--font-weight-bold)',
      '--intent-heading-major-leading': 'var(--leading-2xl)',
      '--intent-caption-size': 'var(--text-xs)',
      '--intent-caption-weight': 'var(--font-weight-normal)',
      '--intent-caption-leading': 'var(--leading-xs)',
    });
  });
});

describe('themeTokensToCssVars — Motion axis', () => {
  it('emits duration palette', () => {
    const motion: MotionTokens = {
      durations: { fast: '100ms', normal: '200ms', dramatic: '600ms' },
    };
    expect(themeTokensToCssVars({ motion }, 'light')).toEqual({
      '--duration-fast': '100ms',
      '--duration-normal': '200ms',
      '--duration-dramatic': '600ms',
    });
  });

  it('emits easing palette', () => {
    const motion: MotionTokens = {
      easings: { linear: 'linear', spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    };
    expect(themeTokensToCssVars({ motion }, 'light')).toEqual({
      '--easing-linear': 'linear',
      '--easing-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
  });

  it('emits motion intent mappings with var(--duration-*) / var(--easing-*) resolution', () => {
    const motion: MotionTokens = {
      intents: {
        enter: { duration: 'fast', easing: 'emphasized' },
        press: { duration: 'instant', easing: 'linear' },
      },
    };
    expect(themeTokensToCssVars({ motion }, 'light')).toEqual({
      '--intent-enter-duration': 'var(--duration-fast)',
      '--intent-enter-easing': 'var(--easing-emphasized)',
      '--intent-press-duration': 'var(--duration-instant)',
      '--intent-press-easing': 'var(--easing-linear)',
    });
  });
});

describe('themeTokensToCssVars — Iconography axis', () => {
  it('emits family + stroke + default-size tokens', () => {
    const iconography: IconographyTokens = {
      family: 'phosphor-duotone',
      strokeWidth: '1.5',
      defaultSize: '20px',
    };
    expect(themeTokensToCssVars({ iconography }, 'light')).toEqual({
      '--icon-family': 'phosphor-duotone',
      '--icon-stroke-width': '1.5',
      '--icon-default-size': '20px',
    });
  });

  it('all IconFamily enum values pass through verbatim', () => {
    const families: Array<IconographyTokens['family']> = [
      'lucide',
      'phosphor-outline',
      'phosphor-fill',
      'phosphor-duotone',
      'tabler',
      'fa-solid',
    ];
    for (const family of families) {
      expect(themeTokensToCssVars({ iconography: { family } }, 'light')).toEqual({
        '--icon-family': family,
      });
    }
  });
});

describe('themeTokensToCssVars — Elevation axis', () => {
  it('emits per-layer elevation tokens', () => {
    const elevation: ElevationTokens = {
      cardElevation: 'var(--shadow-sm)',
      popoverElevation: 'var(--shadow-main)',
      dialogElevation: 'var(--shadow-lg)',
      toastElevation: 'none',
    };
    expect(themeTokensToCssVars({ elevation }, 'light')).toEqual({
      '--elevation-card': 'var(--shadow-sm)',
      '--elevation-popover': 'var(--shadow-main)',
      '--elevation-dialog': 'var(--shadow-lg)',
      '--elevation-toast': 'none',
    });
  });
});

describe('themeTokensToCssVars — Geometry axis', () => {
  it('emits radius rhythm and border rhythm tokens', () => {
    const geometry: GeometryTokens = {
      radiusContainer: '12px',
      radiusInteractive: '9999px',
      radiusPill: '9999px',
      borderHairline: '1px',
      borderStandard: '2px',
      borderHeavy: '3px',
    };
    expect(themeTokensToCssVars({ geometry }, 'light')).toEqual({
      '--radius-container': '12px',
      '--radius-interactive': '9999px',
      '--radius-pill': '9999px',
      '--border-hairline': '1px',
      '--border-standard': '2px',
      '--border-heavy': '3px',
    });
  });
});

describe('themeTokensToCssVars — dark variant cascade for skin axes', () => {
  it('prefers dark variant axis when present, falls back to base per category', () => {
    const tokens: ThemeTokens = {
      density: { buttonHeightMd: '36px' },
      iconography: { family: 'lucide', defaultSize: '16px' },
    };
    const darkVariant: ThemeVariant = {
      density: { buttonHeightMd: '40px' }, // override density
      // No iconography override → falls back to base
    };
    expect(themeTokensToCssVars(tokens, 'dark', darkVariant)).toEqual({
      '--button-height-md': '40px', // dark wins
      '--icon-family': 'lucide', // base
      '--icon-default-size': '16px', // base
    });
  });

  it('emits nothing for unset axes', () => {
    const tokens: ThemeTokens = {};
    expect(themeTokensToCssVars(tokens, 'light')).toEqual({});
  });
});

describe('themeTokensToCssVars — combined-axis fixture (round-trip parity anchor)', () => {
  it('emits a complete cross-axis fixture deterministically', () => {
    // This fixture is the parity anchor — the Rust codegen test
    // `theme.rs::tests::emit_skin_axes_parity` asserts the same input
    // produces the same output (modulo whitespace and per-section comments
    // which Rust adds for legibility).
    const tokens: ThemeTokens = {
      density: {
        spacing: { space3: '12px', space6: '24px' },
        buttonHeightMd: '36px',
      },
      typeScale: {
        bodyFamily: '"Inter", sans-serif',
        scale: { base: { size: '16px', lineHeight: '24px' } },
        intents: {
          bodyDefault: { slot: 'body', size: 'base', weight: 'normal' },
        },
      },
      motion: {
        durations: { normal: '200ms' },
        intents: { hover: { duration: 'fast', easing: 'standard' } },
      },
      iconography: { family: 'lucide' },
      elevation: { cardElevation: 'var(--shadow-sm)' },
      geometry: { radiusContainer: '8px', borderHairline: '1px' },
    };
    expect(themeTokensToCssVars(tokens, 'light')).toEqual({
      '--space-3': '12px',
      '--space-6': '24px',
      '--button-height-md': '36px',
      '--font-family-body': '"Inter", sans-serif',
      '--text-base': '16px',
      '--leading-base': '24px',
      '--intent-body-default-size': 'var(--text-base)',
      '--intent-body-default-weight': 'var(--font-weight-normal)',
      '--intent-body-default-leading': 'var(--leading-base)',
      '--duration-normal': '200ms',
      '--intent-hover-duration': 'var(--duration-fast)',
      '--intent-hover-easing': 'var(--easing-standard)',
      '--icon-family': 'lucide',
      '--elevation-card': 'var(--shadow-sm)',
      '--radius-container': '8px',
      '--border-hairline': '1px',
    });
  });
});
