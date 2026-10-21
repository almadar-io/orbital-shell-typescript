// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { I18nProvider, createTranslate } from '../../core';

afterEach(() => {
  document.documentElement.lang = 'en';
  document.documentElement.removeAttribute('dir');
});

const t = createTranslate({});

describe('I18nProvider documentRoot', () => {
  it('an app-root provider sets <html lang> and dir from its locale', () => {
    render(<I18nProvider value={{ locale: 'ar', direction: 'rtl', t }} documentRoot><span>x</span></I18nProvider>);
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('control: a provider without documentRoot (an embedded preview) leaves the document alone', () => {
    render(<I18nProvider value={{ locale: 'sl', direction: 'ltr', t }}><span>x</span></I18nProvider>);
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.hasAttribute('dir')).toBe(false);
  });

  it('edge: a locale change on the root provider updates the document', () => {
    const { rerender } = render(<I18nProvider value={{ locale: 'en', direction: 'ltr', t }} documentRoot><span>x</span></I18nProvider>);
    rerender(<I18nProvider value={{ locale: 'ar', direction: 'rtl', t }} documentRoot><span>x</span></I18nProvider>);
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
