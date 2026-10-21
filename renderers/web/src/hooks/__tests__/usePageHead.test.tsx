// @vitest-environment jsdom
/**
 * `usePageHead` keeps the document head on the active page's declared
 * contract across client navigation, replacing exactly the tags it (or the
 * build's route document) owns.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { usePageHead, type PageHeadInput } from '../usePageHead';
import { I18nProvider, createTranslate } from '../../core';

function Head({ input }: { input: PageHeadInput | null }): null {
  usePageHead(input);
  return null;
}

const owned = () => Array.from(document.head.querySelectorAll('[data-orb-head]'));
const attr = (selector: string, name: string) => document.head.querySelector(selector)?.getAttribute(name);

afterEach(() => {
  document.head.innerHTML = '';
  document.title = '';
});

describe('usePageHead', () => {
  it('writes a public page head and replaces it on navigation', () => {
    const view = render(<Head input={{ title: 'Home', description: 'Welcome', access: 'public', indexing: 'index', origin: 'https://example.org', path: '/' }} />);
    expect(document.title).toBe('Home');
    expect(attr('link[rel="canonical"]', 'href')).toBe('https://example.org/');
    expect(attr('meta[name="description"]', 'content')).toBe('Welcome');
    view.rerender(<Head input={{ title: 'Docs', access: 'public', indexing: 'index', origin: 'https://example.org', path: '/docs' }} />);
    expect(document.title).toBe('Docs');
    expect(attr('link[rel="canonical"]', 'href')).toBe('https://example.org/docs');
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  });

  it('entering an authenticated or noindex page drops public tags and declares noindex', () => {
    for (const private_ of [{ access: 'authenticated' as const }, { indexing: 'noindex' as const }]) {
      const view = render(<Head input={{ title: 'Home', description: 'Welcome', access: 'public', origin: 'https://example.org', path: '/' }} />);
      view.rerender(<Head input={{ title: 'Account', description: 'Mine', origin: 'https://example.org', path: '/account', ...private_ }} />);
      expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
      expect(document.head.querySelector('meta[name="description"]')).toBeNull();
      expect(attr('meta[name="robots"]', 'content')).toBe('noindex');
      expect(document.title).toBe('Account');
      view.unmount();
    }
  });

  it('replaces the build route document tags on the first client navigation', () => {
    document.head.innerHTML = '<link rel="canonical" href="https://example.org/" data-orb-head /><meta name="description" content="Built" data-orb-head />';
    render(<Head input={{ title: 'Docs', access: 'public', origin: 'https://example.org', path: '/docs' }} />);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(attr('link[rel="canonical"]', 'href')).toBe('https://example.org/docs');
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  });

  it('resolves i18n/t metadata from the active locale catalog', () => {
    const messages = { 'site:meta.home': 'الرئيسية' };
    render(
      <I18nProvider value={{ locale: 'ar', direction: 'rtl', t: createTranslate(messages), messages }}>
        <Head input={{ title: ['i18n/t', 'site:meta.home'], access: 'public', path: '/ar' }} />
      </I18nProvider>,
    );
    expect(document.title).toBe('الرئيسية');
    expect(attr('meta[property="og:locale"]', 'content')).toBe('ar');
  });

  it('control: tags it does not own are left alone, and null writes nothing', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000" /><meta name="description" content="host" />';
    document.title = 'Host';
    render(<Head input={null} />);
    expect(owned()).toHaveLength(0);
    expect(document.title).toBe('Host');
    render(<Head input={{ access: 'public', path: '/' }} />);
    expect(attr('meta[name="theme-color"]', 'content')).toBe('#000');
    expect(attr('meta[name="description"]', 'content')).toBe('host');
  });

  it('writes each translation and the default locale as hreflang alternates', () => {
    const alternates = [{ locale: 'en', path: '/' }, { locale: 'ar', path: '/ar' }];
    const view = render(<Head input={{ access: 'public', origin: 'https://example.org', path: '/ar', alternates, defaultLocale: 'en' }} />);
    expect(attr('link[rel="alternate"][hreflang="en"]', 'href')).toBe('https://example.org/');
    expect(attr('link[rel="alternate"][hreflang="ar"]', 'href')).toBe('https://example.org/ar');
    expect(attr('link[rel="alternate"][hreflang="x-default"]', 'href')).toBe('https://example.org/');
    view.rerender(<Head input={{ access: 'public', origin: 'https://example.org', path: '/docs' }} />);
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
  });

  it('control: alternates need a public page and an origin', () => {
    const alternates = [{ locale: 'en', path: '/' }, { locale: 'ar', path: '/ar' }];
    const view = render(<Head input={{ access: 'authenticated', origin: 'https://example.org', path: '/', alternates, defaultLocale: 'en' }} />);
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
    view.rerender(<Head input={{ access: 'public', path: '/', alternates, defaultLocale: 'en' }} />);
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
  });
});
