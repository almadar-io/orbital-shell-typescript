import { describe, it, expect, afterEach } from 'vitest';
import { resolveCanvasTheme } from '../canvasTheme';
import { mermaidThemeVariables } from '../mermaidTheme';
import { DIAGRAM_TONES, DIAGRAM_TONE_COLOR_KEYS } from '@almadar/core';
import { DIAGRAM_SCOPE_VARS } from '../../test-support/diagram-tones';

function scopeWith(vars: Record<string, string>): HTMLElement {
  const scope = document.createElement('div');
  for (const [k, v] of Object.entries(vars)) scope.style.setProperty(k, v);
  document.body.appendChild(scope);
  return scope;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const ORB_LIKE = DIAGRAM_SCOPE_VARS;

describe('mermaidThemeVariables', () => {
  it('maps the resolved drawing axes onto mermaid base-theme variables', () => {
    const theme = resolveCanvasTheme(scopeWith(ORB_LIKE));
    const v = mermaidThemeVariables(theme, 'light');
    expect(v.background).toBe(theme.ground);
    expect(v.primaryColor).toBe(theme.tones.fill);
    expect(v.primaryBorderColor).toBe(theme.tones.ink);
    expect(v.primaryTextColor).toBe(theme.tones.label);
    expect(v.lineColor).toBe(theme.tones.axis);
    expect(v.clusterBkg).toBe(theme.tones.grid);
    expect(v.noteBorderColor).toBe(theme.tones.highlight);
    expect(v.pie1).toBe(theme.series[0]);
    expect(v.pie2).toBe(theme.series[1]);
    expect(v.fontFamily).toBe(theme.faces[theme.label.font]);
    expect(v.fontSize).toBe(`${theme.text[theme.label.size]}px`);
    expect(v.darkMode).toBe(false);
    expect(v.pieOpacity).toBe('1');
  });

  it('control: a different theme scope yields different variables', () => {
    const a = mermaidThemeVariables(resolveCanvasTheme(scopeWith(ORB_LIKE)), 'light');
    const b = mermaidThemeVariables(
      resolveCanvasTheme(scopeWith({ ...ORB_LIKE, '--color-diagram-fill': 'rgb(10, 20, 30)', '--surface-diagram': 'rgb(0, 0, 0)' })),
      'dark',
    );
    expect(b.primaryColor).not.toBe(a.primaryColor);
    expect(b.background).not.toBe(a.background);
    expect(b.darkMode).toBe(true);
  });

  it('edge: every pie slot is filled from the series, cycling a short palette', () => {
    const theme = resolveCanvasTheme(scopeWith(ORB_LIKE));
    const v = mermaidThemeVariables({ ...theme, series: [theme.series[0], theme.series[1]] }, 'light');
    expect(v.pie3).toBe(theme.series[0]);
    expect(v.pie12).toBe(theme.series[1]);
  });
});

describe('G-ORBITAL-SHELL-TYPESCRIPT-145: mermaid takes only resolved colours', () => {
  const allTones = (): Record<string, string> =>
    Object.fromEntries(DIAGRAM_TONES.map((tone, i) => [`--color-${DIAGRAM_TONE_COLOR_KEYS[tone]}`, `rgb(${i + 1}, 20, 30)`]));

  it('g_orbital_shell_typescript_145_unresolved_tone_fails_by_name', () => {
    const theme = resolveCanvasTheme(scopeWith({ '--surface-diagram': 'rgb(250, 249, 246)' }));
    expect(() => mermaidThemeVariables(theme, 'light')).toThrow(/--color-diagram-ink/);
  });

  it('g_orbital_shell_typescript_145_never_hands_mermaid_currentColor', () => {
    const theme = resolveCanvasTheme(scopeWith({}));
    const vars = (() => {
      try {
        return { ...mermaidThemeVariables(theme, 'light') };
      } catch {
        return undefined;
      }
    })();
    if (vars === undefined) return;
    expect(Object.values(vars).filter((v) => v === 'currentColor')).toEqual([]);
  });

  it('control: a scope declaring every tone yields resolved colours only', () => {
    const vars = mermaidThemeVariables(resolveCanvasTheme(scopeWith(allTones())), 'light');
    expect(Object.values(vars).filter((v) => v === 'currentColor')).toEqual([]);
    expect(vars.primaryBorderColor).toBe(`rgb(${DIAGRAM_TONES.indexOf('ink') + 1}, 20, 30)`);
  });
});
