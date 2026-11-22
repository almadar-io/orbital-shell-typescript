/**
 * A code block scrolls in one element a keyboard can reach: the named, focusable code group. The highlighter's own block
 * never scrolls inside it (axe scrollable-region-focusable), and a block is a group, not a page landmark, so several
 * untitled blocks on one page do not repeat a landmark name (axe landmark-unique).
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { CodeBlock, preloadCodeHighlighter } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

beforeAll(() => preloadCodeHighlighter());

const LONG = `const line = "${'x'.repeat(400)}";\nconst next = 1;`;

async function block(title?: string): Promise<HTMLElement> {
  const { container } = render(
    <EventBusProvider debug={false}>
      <CodeBlock code={LONG} language="typescript" {...(title !== undefined ? { title } : {})} />
    </EventBusProvider>,
  );
  await new Promise((r) => setTimeout(r, 300));
  return container;
}

const scrolls = (el: HTMLElement): boolean =>
  [el.style.overflow, el.style.overflowX, el.style.overflowY].some((v) => v === 'auto' || v === 'scroll') || /\boverflow(-[xy])?-(auto|scroll)\b/.test(el.className);

describe('CodeBlock keyboard scrolling', () => {
  for (const [mode, title] of [['standard', undefined], ['viewer', 'cart.ts']] as const) {
    it(`${mode}: only the focusable code group scrolls`, async () => {
      const container = await block(title);
      const group = container.querySelector<HTMLElement>('[role="group"][tabindex="0"]');
      expect(group).not.toBeNull();
      expect(group?.getAttribute('aria-label')).toBe(title ?? 'Code');
      const inner = Array.from(group!.querySelectorAll<HTMLElement>('*')).filter(scrolls);
      expect(inner.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
    });

    it(`control ${mode}: the code group itself scrolls`, async () => {
      const container = await block(title);
      expect(scrolls(container.querySelector<HTMLElement>('[role="group"][tabindex="0"]')!)).toBe(true);
    });
  }

  it('a code block is not a page landmark', async () => {
    const container = await block();
    expect(container.querySelector('[role="region"]')).toBeNull();
  });
});
