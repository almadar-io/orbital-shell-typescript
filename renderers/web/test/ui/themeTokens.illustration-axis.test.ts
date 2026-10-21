/**
 * themeTokens — illustration axis. A theme's `illustration.loadingAsset` becomes
 * `--illustration-loading` (a CSS `url()`), which the Spinner paints in place of
 * its generic icon; the dark variant may carry its own artwork. Twin of the
 * compiled path's `emit_skin_axes` (orbital-shell-typescript `codegen/theme`).
 */
import { describe, it, expect } from 'vitest';
import type { IllustrationTokens, ThemeTokens, ThemeVariant } from '@almadar/core';
import { themeTokensToCssVars } from '../../src/lib/themeTokens';

const light = 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E';
const dark = 'data:image/svg+xml;utf8,%3Csvg%20id=%22d%22%3E%3C/svg%3E';

describe('themeTokensToCssVars — Illustration axis', () => {
  it('emits the loading artwork as a url() and switches the spinner to it', () => {
    const illustration: IllustrationTokens = { loadingAsset: light };
    const vars = themeTokensToCssVars({ illustration }, 'light');
    expect(vars['--illustration-loading']).toBe(`url("${light}")`);
    expect(vars['--loader-mark-display']).toBe('inline-block');
    expect(vars['--loader-icon-display']).toBe('none');
  });

  it('uses the dark variant artwork in dark mode', () => {
    const tokens: ThemeTokens = { illustration: { loadingAsset: light } };
    const variant: ThemeVariant = { illustration: { loadingAsset: dark } };
    expect(themeTokensToCssVars(tokens, 'dark', variant)['--illustration-loading']).toBe(`url("${dark}")`);
  });

  it('control: a theme without loading artwork leaves the spinner on its icon', () => {
    const vars = themeTokensToCssVars({ illustration: { style: 'minimal' } }, 'light');
    expect(vars['--illustration-loading']).toBeUndefined();
    expect(vars['--loader-icon-display']).toBeUndefined();
  });
});
