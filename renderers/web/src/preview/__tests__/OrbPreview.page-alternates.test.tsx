// @vitest-environment jsdom
/**
 * On the interpreter path the document head carries the active page's
 * translations as hreflang alternates, from the pages sharing its
 * `sourcePage` (the imports of one upstream page per locale).
 */
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function orbital(name: string, path: string, sourcePage?: string): OrbitalSchema['orbitals'][number] {
  return {
    name,
    entity: { name: `${name}State`, persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: `${name}View`,
      scope: 'instance',
      linkedEntity: `${name}State`,
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: name }]] }],
      },
    }],
    pages: [{ name: `${name}Page`, path, traits: [{ ref: `${name}View` }], access: 'public', indexing: 'index', title: name, ...(sourcePage ? { sourcePage } : {}) }],
  } as OrbitalSchema['orbitals'][number];
}

const app: OrbitalSchema = {
  name: 'site',
  locales: ['en', 'ar'],
  site: { origin: 'https://example.org' },
  orbitals: [orbital('HomeEN', '/', 'pag_home'), orbital('HomeAR', '/ar', 'pag_home'), orbital('Docs', '/docs')],
};

afterEach(() => {
  document.head.innerHTML = '';
});

const hreflang = (lang: string) => document.head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`)?.getAttribute('href');

describe('page alternates on the interpreter', () => {
  it('a translated page lists every translation and the default locale', async () => {
    render(<MemoryRouter><OrbPreview schema={app} initialPagePath="/ar" /></MemoryRouter>);
    await screen.findByText('HomeAR');
    expect(hreflang('en')).toBe('https://example.org/');
    expect(hreflang('ar')).toBe('https://example.org/ar');
    expect(hreflang('x-default')).toBe('https://example.org/');
  });

  it('control: a page with no translations lists none', async () => {
    render(<MemoryRouter><OrbPreview schema={app} initialPagePath="/docs" /></MemoryRouter>);
    await screen.findByText('Docs');
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
  });
});
