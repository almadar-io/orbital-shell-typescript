/**
 * Every token a code block paints reads at WCAG AA on the surface it is drawn on, in the general grammar themes as well
 * as the Orb/Lolo palette: the light theme's faint colours are taken to the nearest legible shade (legibleColor).
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { CODE_SURFACES } from '@almadar/syntax';
import { contrastRatio, MIN_TEXT_CONTRAST } from '@almadar/core';
import { CodeBlock, preloadCodeHighlighter } from '../CodeBlock';
import { EventBusProvider, ThemeProvider } from '../../../../../core';

beforeAll(() => preloadCodeHighlighter());

const TS = 'const total: number = items.reduce((sum, i) => sum + i.price, 0); // running total\nexport function pick(a: string): boolean { return a.length > 3 && /x+/.test(a); }';

function hex(rgb: string): string {
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(rgb);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : rgb;
}

async function renderBlock(showLineNumbers: boolean): Promise<HTMLElement> {
  const { container } = render(
    <ThemeProvider defaultTheme="wireframe" defaultMode="light">
      <EventBusProvider debug={false}>
        <CodeBlock code={TS} language="typescript" title="pick.ts" showLineNumbers={showLineNumbers} />
      </EventBusProvider>
    </ThemeProvider>,
  );
  await new Promise((r) => setTimeout(r, 300));
  return container;
}

async function tokenColors(): Promise<string[]> {
  const container = await renderBlock(false);
  return [...new Set(Array.from(container.querySelectorAll<HTMLElement>('.token')).map((el) => el.style.color).filter((c) => c !== '').map(hex))];
}

describe('code token contrast', () => {
  it('every token colour of a light TypeScript block reads on every light code surface', async () => {
    const colors = await tokenColors();
    expect(colors.length).toBeGreaterThan(2);
    const failing = colors.flatMap((c) => CODE_SURFACES.light.filter((bg) => (contrastRatio(c, bg) ?? 0) < MIN_TEXT_CONTRAST).map((bg) => `${c} on ${bg}`));
    expect(failing).toEqual([]);
  });
});

describe('line number contrast', () => {
  it('the line-number gutter is drawn at full opacity in a colour legible on every light code surface', async () => {
    const container = await renderBlock(true);
    const numbers = Array.from(container.querySelectorAll<HTMLElement>('.linenumber'));
    expect(numbers.length).toBe(2);
    const failing = numbers.flatMap((el) => {
      const opacity = el.style.opacity === '' ? 1 : Number(el.style.opacity);
      const color = hex(el.style.color);
      return CODE_SURFACES.light.filter((bg) => opacity < 1 || (contrastRatio(color, bg) ?? 0) < MIN_TEXT_CONTRAST).map((bg) => `${color} @${opacity} on ${bg}`);
    });
    expect(failing).toEqual([]);
  });

  it('control: without showLineNumbers no gutter numbers are drawn inline', async () => {
    const container = await renderBlock(false);
    expect(container.querySelectorAll('.linenumber').length).toBe(0);
  });
});
