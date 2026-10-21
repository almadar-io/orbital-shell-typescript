/**
 * Arabic code reads right to left: the line flows RTL token by token, every
 * English token (name, string, number) is its own LTR island so it reads
 * correctly, and brackets/arrows stay in the RTL flow so they mirror.
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CodeBlock, preloadCodeHighlighter } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';
import { I18nProvider, createTranslate } from '../../../../../core';

// Blocks paint highlighted only once the on-demand highlighter is in (G-UI-105).
beforeAll(() => preloadCodeHighlighter());

const LOLO = 'app orders "1.0.0"\n"An order that cannot ship before it is paid."\n\norbital Orders {\n  entity Order [runtime] {\n    total : number\n  }\n}';

function mount(locale: string) {
  return render(
    <I18nProvider value={{ locale, direction: locale === 'ar' ? 'rtl' : 'ltr', t: createTranslate({}) }}>
      <EventBusProvider debug={false}>
        <CodeBlock code={LOLO} language="lolo" title="checkout.lolo" naturalLanguages={['en', 'ar', 'sl']} />
      </EventBusProvider>
    </I18nProvider>,
  );
}

const settle = () => new Promise((r) => setTimeout(r, 300));

function codeBox(container: HTMLElement): HTMLElement {
  const line = container.querySelector<HTMLElement>('[data-line]');
  const box = line?.closest<HTMLElement>('[dir]');
  if (!box) throw new Error('no code box');
  return box;
}

function islands(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-bidi-island]')).map((el) => el.textContent ?? '');
}

describe('CodeBlock Arabic code direction', () => {
  it('the Arabic tab lays code out right to left, each English token an LTR island', async () => {
    const { container } = mount('ar');
    await settle();
    expect(codeBox(container).getAttribute('dir')).toBe('rtl');
    const found = islands(container);
    expect(found).toContain('Orders');
    expect(found).toContain('total');
    // A string literal stays whole, so an English sentence reads in order.
    expect(found).toContain('"An order that cannot ship before it is paid."');
  });

  it('brackets and arrows are not islands: they stay in the RTL flow and mirror', async () => {
    const { container } = mount('ar');
    await settle();
    expect(islands(container).some((text) => /[{}()[\]]/.test(text) && !text.startsWith('"'))).toBe(false);
  });

  it('the code tab defaults to the page language when it is offered', async () => {
    const { getByTestId } = mount('ar');
    await settle();
    expect(getByTestId('tab-lang-ar').getAttribute('aria-selected')).toBe('true');
  });

  it('control: on an English page the code is LTR with no islands', async () => {
    const { container, getByTestId } = mount('en');
    await settle();
    expect(getByTestId('tab-lang-en').getAttribute('aria-selected')).toBe('true');
    expect(codeBox(container).getAttribute('dir')).toBe('ltr');
    expect(islands(container)).toEqual([]);
  });

  it('control: switching an English page to the Arabic tab turns the code RTL', async () => {
    const { container, getByTestId } = mount('en');
    await settle();
    fireEvent.click(getByTestId('tab-lang-ar'));
    await settle();
    expect(codeBox(container).getAttribute('dir')).toBe('rtl');
  });

  it('control: a page language with no tab falls back to the first tab', async () => {
    const { getByTestId } = mount('fr');
    await settle();
    expect(getByTestId('tab-lang-en').getAttribute('aria-selected')).toBe('true');
  });
});
