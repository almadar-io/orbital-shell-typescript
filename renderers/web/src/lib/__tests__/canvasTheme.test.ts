import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveCanvasTheme,
  markColor,
  markStrokeWidth,
  labelFont,
  labelText,
  fillLabel,
  outlineStroke,
  outlineCarriesFill,
  markDash,
  isDiagramTone,
  withSeries,
} from '../canvasTheme';

function scopeWith(vars: Record<string, string>): HTMLElement {
  const scope = document.createElement('div');
  for (const [k, v] of Object.entries(vars)) scope.style.setProperty(k, v);
  document.body.appendChild(scope);
  return scope;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveCanvasTheme', () => {
  it('reads every drawing axis declared on the scope', () => {
    const scope = scopeWith({
      '--surface-diagram': '#102030',
      '--color-muted': '#203040',
      '--color-card': 'rgb(5, 6, 7)',
      '--color-primary-foreground': '#fafafa',
      '--color-diagram-ink': 'rgb(1, 2, 3)',
      '--color-series-2': 'oklch(0.627955 0.257683 29.2339)',
      '--diagram-stroke-thin': '1px',
      '--diagram-stroke-normal': '3px',
      '--diagram-stroke-bold': '6px',
      '--diagram-line-cap': 'square',
      '--diagram-line-join': 'bevel',
      '--diagram-dash': '8 2',
      '--diagram-fill-style': 'hatch',
      '--diagram-fill-opacity': '0.3',
      '--diagram-roughness': '1.5',
      '--diagram-glow': '6',
      '--diagram-marker': 'open',
      '--diagram-label-font': 'mono',
      '--diagram-label-size': 'xs',
      '--diagram-label-weight': '700',
      '--diagram-label-case': 'uppercase',
      '--font-family-mono': '"JetBrains Mono", monospace',
      '--text-xs': '11px',
      '--material-flat': '1',
      '--light-ambient': '0.3',
      '--motion-enable': 'off',
    });
    const t = resolveCanvasTheme(scope);
    expect(t.ground).toBe('rgb(16, 32, 48)');
    expect(t.surfaces).toEqual({ muted: 'rgb(32, 48, 64)', card: 'rgb(5, 6, 7)', onPrimary: 'rgb(250, 250, 250)' });
    expect(t.tones.ink).toBe('rgb(1, 2, 3)');
    expect(t.series[1]).toBe('rgb(255, 0, 0)');
    expect(t.strokes).toEqual({ thin: 1, normal: 3, bold: 6 });
    expect(t.lineCap).toBe('square');
    expect(t.lineJoin).toBe('bevel');
    expect(t.dash).toEqual([8, 2]);
    expect(t.fillStyle).toBe('hatch');
    expect(t.fillOpacity).toBe(0.3);
    expect(t.roughness).toBe(1.5);
    expect(t.glow).toBe(6);
    expect(t.marker).toBe('open');
    expect(t.label).toEqual({ font: 'mono', size: 'xs', weight: '700', uppercase: true });
    expect(t.faces.mono).toBe('"JetBrains Mono", monospace');
    expect(t.text.xs).toBe(11);
    expect(t.scene.flat).toBe(true);
    expect(t.scene.ambient).toBe(0.3);
    expect(t.motion.enabled).toBe(false);
    expect(scope.childElementCount).toBe(0);
  });

  it('control: an undeclared scope gets the contract defaults, never throws', () => {
    const t = resolveCanvasTheme(scopeWith({}));
    expect(t.strokes).toEqual({ thin: 1, normal: 1.5, bold: 3 });
    expect(t.lineCap).toBe('round');
    expect(t.fillStyle).toBe('tint');
    expect(t.roughness).toBe(0);
    expect(t.motion.enabled).toBe(true);
    expect(t.surfaces).toEqual({ muted: 'transparent', card: 'transparent', onPrimary: 'transparent' });
  });

  it('edge: an invalid keyword falls back to the default instead of reaching the canvas', () => {
    const t = resolveCanvasTheme(scopeWith({ '--diagram-line-cap': 'wavy', '--diagram-dash': '6 x' }));
    expect(t.lineCap).toBe('round');
    expect(t.dash).toEqual([6, 4]);
  });
});

describe('mark role helpers', () => {
  const scope = (): HTMLElement => scopeWith({ '--color-diagram-guide': '#00ff00', '--color-diagram-ink': '#000000', '--diagram-stroke-bold': '5px', '--text-lg': '20px' });

  it('a tone name resolves through the theme; a literal passes through; absent uses the fallback tone', () => {
    const s = scope();
    const t = resolveCanvasTheme(s);
    expect(markColor(t, 'guide', s, 'ink')).toBe('rgb(0, 255, 0)');
    expect(markColor(t, '#abcdef', s, 'ink')).toBe('#abcdef');
    expect(markColor(t, undefined, s, 'ink')).toBe('rgb(0, 0, 0)');
  });

  it('a literal width wins over the role, the role over the theme default', () => {
    const t = resolveCanvasTheme(scope());
    expect(markStrokeWidth(t, 7, 'bold')).toBe(7);
    expect(markStrokeWidth(t, undefined, 'bold')).toBe(5);
    expect(markStrokeWidth(t, undefined, undefined)).toBe(t.strokes.normal);
  });

  it('label font: literal px wins; the text role reads the type scale; case follows the theme', () => {
    const t = resolveCanvasTheme(scope());
    expect(labelFont(t, { textSize: 'lg' }).px).toBe(20);
    expect(labelFont(t, { textSize: 'lg' }, 9).px).toBe(9);
    expect(labelText({ ...t, label: { ...t.label, uppercase: true } }, 'Pivot')).toBe('PIVOT');
    expect(labelText(t, 'Pivot')).toBe('Pivot');
  });

  it('a verbatim label keeps its letters under an uppercase label theme', () => {
    const t = resolveCanvasTheme(scope());
    const upper = { ...t, label: { ...t.label, uppercase: true } };
    for (const symbol of ['mg', 'pH', 'mL', 'Na', 'θ', 'π estimate']) expect(labelText(upper, symbol, 'verbatim')).toBe(symbol);
    expect(labelText(upper, 'pivot', 'theme')).toBe('PIVOT');
    expect(labelText(upper, 'pivot')).toBe('PIVOT');
    expect(labelText(t, 'pH', 'verbatim')).toBe('pH');
    expect(labelText(t, 'pH', 'theme')).toBe('pH');
  });

  it('dash roles read the theme patterns', () => {
    const t = resolveCanvasTheme(scope());
    expect(markDash(t, 'dashed')).toEqual(t.dash);
    expect(markDash(t, 'dotted')).toEqual(t.dot);
    expect(markDash(t, 'solid')).toEqual([]);
  });

  it('isDiagramTone accepts role names and rejects colors', () => {
    expect(isDiagramTone('series-3')).toBe(true);
    expect(isDiagramTone('#ff0000')).toBe(false);
  });
});

describe('withSeries — the categorical palette override', () => {
  it('replaces series-N with the override (cycling), resolving tone names', () => {
    const scope = scopeWith({ '--color-diagram-ink': '#000000', '--color-series-1': '#111111' });
    const base = resolveCanvasTheme(scope);
    const t = withSeries(base, ['#ff0000', 'ink'], scope);
    expect(t?.tones['series-1']).toBe('#ff0000');
    expect(t?.tones['series-2']).toBe('rgb(0, 0, 0)');
    expect(t?.tones['series-3']).toBe('#ff0000');
    expect(t?.series[1]).toBe('rgb(0, 0, 0)');
  });

  it('control: no override returns the theme unchanged', () => {
    const scope = scopeWith({ '--color-series-1': '#111111' });
    const base = resolveCanvasTheme(scope);
    expect(withSeries(base, undefined, scope)).toBe(base);
    expect(withSeries(base, [], scope)).toBe(base);
  });
});

describe('fillLabel', () => {
  function recorder() {
    const calls: string[] = [];
    const ctx = {
      strokeStyle: '' as CanvasRenderingContext2D['strokeStyle'],
      lineWidth: 0,
      lineJoin: 'miter' as CanvasLineJoin,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      strokeText: (t: string) => calls.push(`halo:${t}`),
      fillText: (t: string) => calls.push(`fill:${t}`),
    };
    return { ctx, calls };
  }

  it('paints a ground-colored halo under the glyphs, then the glyphs', () => {
    const t = resolveCanvasTheme(scopeWith({ '--surface-diagram': '#102030' }));
    const { ctx, calls } = recorder();
    fillLabel(ctx, t, 'Nucleus', 10, 10);
    expect(calls).toEqual(['save', 'halo:Nucleus', 'restore', 'fill:Nucleus']);
    expect(ctx.strokeStyle).toBe(t.ground);
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.lineWidth).toBeGreaterThanOrEqual(2);
  });

  it('control: an empty label draws nothing', () => {
    const { ctx, calls } = recorder();
    fillLabel(ctx, resolveCanvasTheme(scopeWith({})), '', 0, 0);
    expect(calls).toEqual([]);
  });
});

describe('outlineStroke', () => {
  it('an outline-style mark draws its fill color as its outline, so the meaning the fill carried survives', () => {
    expect(outlineStroke('#111111', '#ff0000', 'outline')).toBe('#ff0000');
  });

  it('control: filled styles keep the declared stroke', () => {
    for (const style of ['solid', 'tint', 'hatch'] as const) expect(outlineStroke('#111111', '#ff0000', style)).toBe('#111111');
  });

  it('edge: an outline mark with no fill keeps its stroke', () => {
    expect(outlineStroke('#111111', undefined, 'outline')).toBe('#111111');
  });

  it('outlineCarriesFill names exactly the marks whose outline stands in for a meaningful fill', () => {
    expect(outlineCarriesFill('#ff0000', 'outline', 'highlight')).toBe(true);
    expect(outlineCarriesFill('#f0f0f0', 'outline', 'fill')).toBe(false);
    expect(outlineCarriesFill(undefined, 'outline')).toBe(false);
    expect(outlineCarriesFill('#ff0000', 'tint', 'highlight')).toBe(false);
  });

  it('edge: a mark filled with the background `fill` tint keeps its stroke (the tint carries no meaning)', () => {
    expect(outlineStroke('#111111', '#f0f0f0', 'outline', 'fill')).toBe('#111111');
    expect(outlineStroke('#111111', '#ff0000', 'outline', 'highlight')).toBe('#ff0000');
  });
});
