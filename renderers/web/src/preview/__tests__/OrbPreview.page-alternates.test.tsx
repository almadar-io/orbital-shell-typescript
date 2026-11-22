// @vitest-environment jsdom
/**
 * The document head is the head the compiler stamped on the active page (`head`, the one `routes.json` carries): its
 * title, description and hreflang alternates are applied as written, never recomputed from the pages the client holds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrbitalSchema, PageHead } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function orbital(name: string, path: string, sourcePage?: string, head?: PageHead, title: string | ['i18n/t', string] = name): OrbitalSchema['orbitals'][number] {
  return {
    name,
    entity: { name: `${name}State`, persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: `${name}View`,
      linkedEntity: `${name}State`,
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: name }]] }],
      },
    }],
    pages: [{ name: `${name}Page`, path, traits: [{ ref: `${name}View` }], access: 'public', indexing: 'index', title, ...(sourcePage ? { sourcePage } : {}), ...(head ? { head } : {}) }],
  } as OrbitalSchema['orbitals'][number];
}

const app: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'site',
  locales: ['en', 'ar'],
  site: { origin: 'https://example.org' },
  orbitals: [orbital('HomeEN', '/', 'pag_home'), orbital('HomeAR', '/ar', 'pag_home'), orbital('Docs', '/docs')],
};

const ALTERNATES = [{ locale: 'en', path: '/' }, { locale: 'ar', path: '/ar' }];
const stamped: OrbitalSchema = {
  ...app,
  orbitals: [
    orbital('HomeEN', '/', 'pag_home', { title: 'Home', alternates: ALTERNATES }),
    orbital('HomeAR', '/ar', 'pag_home', { title: 'الرئيسية', description: 'وصف', alternates: ALTERNATES }, ['i18n/t', 'site:meta.home']),
    orbital('Docs', '/docs', undefined, { title: 'Docs' }),
  ],
};

afterEach(() => {
  document.head.innerHTML = '';
});

const hreflang = (lang: string) => document.head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`)?.getAttribute('href');

describe('the stamped page head', () => {
  it('a translated page lists every translation and the default locale its head names', async () => {
    render(<MemoryRouter><OrbPreview schema={stamped} initialPagePath="/ar" /></MemoryRouter>);
    await screen.findByText('HomeAR');
    expect(hreflang('en')).toBe('https://example.org/');
    expect(hreflang('ar')).toBe('https://example.org/ar');
    expect(hreflang('x-default')).toBe('https://example.org/');
  });

  it('the head title and description are written even when the page title is a message the client has no catalog for', async () => {
    render(<MemoryRouter><OrbPreview schema={stamped} initialPagePath="/ar" /></MemoryRouter>);
    await screen.findByText('HomeAR');
    expect(document.title).toBe('الرئيسية');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('وصف');
  });

  it('control: a page whose head has no translations lists none', async () => {
    render(<MemoryRouter><OrbPreview schema={stamped} initialPagePath="/docs" /></MemoryRouter>);
    await screen.findByText('Docs');
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
  });

  it('control: an unstamped page lists no translations, however its pages are grouped', async () => {
    render(<MemoryRouter><OrbPreview schema={app} initialPagePath="/ar" /></MemoryRouter>);
    await screen.findByText('HomeAR');
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
    expect(document.title).toBe('HomeAR');
  });
});
