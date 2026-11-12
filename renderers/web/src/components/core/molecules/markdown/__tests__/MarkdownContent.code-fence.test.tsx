/**
 * A fenced block is a block whether or not it names a language: it renders as one code block, never as inline code
 * broken over its lines, and it reads left to right on a right-to-left page.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownContent } from '../MarkdownContent';
import { I18nProvider, createTranslate } from '../../../../../core';

const bare = 'Text.\n\n```\norbital Social {\n  entity Post\n}\n```\n\nAnd `x` inline.\n';

function mount(locale: string) {
  return render(
    <I18nProvider value={{ locale, direction: locale === 'ar' ? 'rtl' : 'ltr', t: createTranslate({}) }}>
      <MarkdownContent content={bare} />
    </I18nProvider>,
  );
}

describe('MarkdownContent code fences', () => {
  it('a fence without a language is one code block', () => {
    const { container } = mount('en');
    const blocks = container.querySelectorAll('.prose > div');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toContain('orbital Social {');
    expect(container.querySelector('.prose > code')).toBeNull();
  });

  it('on a right-to-left page the block reads left to right', () => {
    const { container } = mount('ar');
    expect(container.querySelector('.prose > div [role="region"]')?.getAttribute('dir')).toBe('ltr');
  });

  it('control: inline code stays inline', () => {
    const { container } = mount('en');
    expect(container.querySelector('p code')?.textContent).toBe('x');
    expect(container.querySelector('p [role="region"]')).toBeNull();
  });
});
