import { describe, it, expect, afterEach } from 'vitest';
import { resolveCanvasTheme } from '../canvasTheme';
import { mermaidThemeVariables } from '../mermaidTheme';

function scopeWith(vars: Record<string, string>): HTMLElement {
  const scope = document.createElement('div');
  for (const [k, v] of Object.entries(vars)) scope.style.setProperty(k, v);
  document.body.appendChild(scope);
  return scope;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const ORB_LIKE = {
  '--surface-diagram': 'rgb(250, 249, 246)',
  '--color-diagram-ink': 'rgb(20, 22, 26)',
  '--color-diagram-label': 'rgb(40, 42, 46)',
  '--color-diagram-axis': 'rgb(90, 92, 96)',
  '--color-diagram-grid': 'rgb(230, 228, 222)',
  '--color-diagram-guide': 'rgb(150, 150, 150)',
  '--color-diagram-fill': 'rgb(224, 240, 241)',
  '--color-diagram-highlight': 'rgb(0, 118, 124)',
  '--color-series-1': 'rgb(0, 118, 124)',
  '--color-series-2': 'rgb(200, 80, 40)',
};

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
