/**
 * A trace inset is a chart on the drawing ground: its panel is opaque ground, never the theme's
 * `fill` tone (sketch's highlighter yellow buried the curve and its labels).
 */
import { describe, it, expect } from 'vitest';
import { resolveCanvasTheme } from '../../../../lib/canvasTheme';
import { traceShapes, readoutShapes } from '../LearningCanvas';

function theme() {
  const scope = document.createElement('div');
  scope.style.setProperty('--surface-diagram', '#fdfcf7');
  scope.style.setProperty('--color-diagram-fill', '#ffe14d');
  document.body.appendChild(scope);
  return resolveCanvasTheme(scope);
}

const panel = { series: [{ samples: [{ x: 0, y: 1 }, { x: 10, y: 7 }], label: 'pH' }], xLabel: 'mL', yLabel: 'pH' };

describe('trace panel ground', () => {
  it('paints the panel with the drawing ground, not the fill tone', () => {
    const t = theme();
    const frame = traceShapes(panel, 0, 600, 400, t)[0];
    expect(frame.type).toBe('rect');
    expect(frame.fill).toBe(t.ground);
    expect(frame.fill).not.toBe('fill');
  });

  it('control: a declared panel background still wins', () => {
    const frame = traceShapes({ ...panel, backgroundColor: 'muted' }, 0, 600, 400, theme())[0];
    expect(frame.fill).toBe('muted');
  });

  it('edge: a single-sample series still yields a framed panel and its axis labels', () => {
    const out = traceShapes({ ...panel, series: [{ samples: [{ x: 0, y: 1 }], label: 'pH' }] }, 0, 600, 400, theme());
    expect(out[0].type).toBe('rect');
    expect(out.filter((s) => s.type === 'text').map((s) => s.text)).toEqual(['pH', 'mL']);
  });
});

describe('trace panel labels', () => {
  const texts = (out: ReturnType<typeof traceShapes>) => out.filter((s) => s.type === 'text');

  it('a single series is named by the axis label, not repeated as a legend', () => {
    expect(texts(traceShapes(panel, 0, 600, 400, theme())).map((s) => s.text)).toEqual(['pH', 'mL']);
  });

  it('two or more series get a legend: label voice text and a swatch in the series color', () => {
    const two = { ...panel, series: [{ samples: panel.series[0].samples, label: 'strong' }, { samples: panel.series[0].samples, label: 'weak', color: 'series-3' }] };
    const out = traceShapes(two, 0, 600, 400, theme());
    const legend = texts(out).filter((s) => s.text === 'strong' || s.text === 'weak');
    expect(legend.map((s) => s.tone)).toEqual(['label', 'label']);
    expect(legend.every((s) => s.color === undefined)).toBe(true);
    const swatches = out.filter((s) => s.type === 'line' && s.id?.startsWith('trace-swatch-'));
    expect(swatches.map((s) => s.color)).toEqual(['series-1', 'series-3']);
  });

  it('control: a single series without an axis label keeps its name as the legend', () => {
    const out = traceShapes({ series: panel.series }, 0, 600, 400, theme());
    expect(texts(out).map((s) => s.text)).toEqual(['pH']);
  });

  it('axis, legend and readout text keep their letters under an uppercase theme', () => {
    const out = traceShapes(panel, 0, 600, 400, theme());
    expect(texts(out).every((s) => s.textCase === 'verbatim')).toBe(true);
    const chips = readoutShapes([{ label: 'mL added', value: 0 }], 600, theme());
    expect(chips.filter((s) => s.type === 'text').map((s) => s.textCase)).toEqual(['verbatim']);
  });
});
