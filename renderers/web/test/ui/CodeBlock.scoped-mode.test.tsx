// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CodeBlock } from '../../src/components/core/molecules/markdown/CodeBlock';
import { EventBusProvider } from '../../src/core';
import { ThemeProvider } from '../../src/core';
import { OrbitalThemeProvider } from '../../src/providers/OrbitalThemeProvider';

const DARK_PLAIN = 'rgb(212, 212, 212)';
const LIGHT_PLAIN = 'rgb(57, 58, 52)';

function viewer(): React.ReactElement {
  return <CodeBlock code={'{ "a": 1 }'} language="json" title="a.json" showLineNumbers />;
}

async function codeColor(tree: React.ReactElement): Promise<string> {
  const { container } = render(<EventBusProvider debug={false}>{tree}</EventBusProvider>);
  let color = '';
  await waitFor(() => {
    const pre = container.querySelector('[role="region"] code')?.parentElement;
    expect(pre).toBeTruthy();
    color = (pre as HTMLElement).style.color;
    expect(color).not.toBe('');
  });
  return color;
}

describe('CodeBlock viewer palette follows the scoped theme mode', () => {
  it('a single-mode dark theme inside a light document draws the dark palette', async () => {
    const color = await codeColor(
      <ThemeProvider defaultTheme="orb" defaultMode="light">
        <OrbitalThemeProvider theme="game-adventure-dark">{viewer()}</OrbitalThemeProvider>
      </ThemeProvider>,
    );
    expect(color).toBe(DARK_PLAIN);
  });

  it('control: a light document with no orbital theme draws the light palette', async () => {
    const color = await codeColor(
      <ThemeProvider defaultTheme="orb" defaultMode="light">{viewer()}</ThemeProvider>,
    );
    expect(color).toBe(LIGHT_PLAIN);
  });

  it('a two-mode theme key follows the document: orb-light in a dark document draws the dark palette', async () => {
    const color = await codeColor(
      <ThemeProvider defaultTheme="orb" defaultMode="dark">
        <OrbitalThemeProvider theme="orb-light">{viewer()}</OrbitalThemeProvider>
      </ThemeProvider>,
    );
    expect(color).toBe(DARK_PLAIN);
  });
});
