/**
 * The viewer panel sits on the theme's own surface, so its token colors follow
 * the theme's light/dark mode. The standard block paints its own dark box and
 * keeps the dark palette in every mode.
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { ORB_COLORS } from '@almadar/syntax';
import { CodeBlock, preloadCodeHighlighter } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

// Blocks paint highlighted only once the on-demand highlighter is in (G-UI-105).
beforeAll(() => preloadCodeHighlighter());
import { ThemeProvider } from '../../../../../core';

const LOLO = 'trait Cart -> Product [interaction] {\n  initial: idle\n}';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function keywordColors(mode: 'light' | 'dark', viewer: boolean): Promise<string[]> {
  const { container } = render(
    <ThemeProvider defaultTheme="wireframe" defaultMode={mode}>
      <EventBusProvider debug={false}>
        <CodeBlock code={LOLO} language="lolo" title={viewer ? 'cart.lolo' : undefined} />
      </EventBusProvider>
    </ThemeProvider>,
  );
  await new Promise((r) => setTimeout(r, 300));
  return Array.from(container.querySelectorAll<HTMLElement>('.token'))
    .filter((el) => el.textContent === 'trait')
    .map((el) => el.style.color);
}

describe('CodeBlock syntax palette follows the surface it is drawn on', () => {
  it('viewer in a light theme uses the light palette', async () => {
    const colors = await keywordColors('light', true);
    expect(colors.length).toBeGreaterThan(0);
    expect(colors).toContain(hexToRgb(ORB_COLORS.light.loloKeyword));
    expect(colors).not.toContain(hexToRgb(ORB_COLORS.dark.loloKeyword));
  });

  it('control: viewer in a dark theme uses the dark palette', async () => {
    const colors = await keywordColors('dark', true);
    expect(colors).toContain(hexToRgb(ORB_COLORS.dark.loloKeyword));
  });

  it('control: the standard block keeps the dark palette in a light theme (its box is dark)', async () => {
    const colors = await keywordColors('light', false);
    expect(colors).toContain(hexToRgb(ORB_COLORS.dark.loloKeyword));
  });
});
