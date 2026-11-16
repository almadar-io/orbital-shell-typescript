// @vitest-environment jsdom
/**
 * Navigating to a lazy page keeps the page on screen until the lazy page's program has loaded, then swaps; a lazy
 * page the preview opens on, with nothing shown before it, shows the loading state while it loads.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LazyPage, OrbitalSchema } from '@almadar/core';
import type { LoadResult, LoadedSchema, SchemaLoader } from '@almadar/shell-runtime/loader/schema-loader';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const docsPage: LazyPage = { path: '/docs', orbital: 'Docs', orbRef: 'lazy/Docs.orb' };

const site: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'site',
  version: '1.0.0',
  orbitals: [
    {
      name: 'Home',
      entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{
          name: "HomeScreen",
          linkedEntity: 'Item',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [],
            transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'page-header', title: 'Home page', actions: [{ label: 'Open docs', navigatesTo: '/docs' }] }]] }],
          },
        }],
      pages: [{ name: 'HomePage', path: '/', traits: [{ ref: 'HomeScreen' }] }],
    },
  ],
  lazyPages: [docsPage],
} as OrbitalSchema;

const docs: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'Docs',
  version: '1.0.0',
  orbitals: [
    {
      name: 'Docs',
      entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{
          name: "DocsScreen",
          linkedEntity: 'Item',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [],
            transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'Docs page' }]] }],
          },
        }],
      pages: [{ name: 'DocsPage', path: '/docs', traits: [{ ref: 'DocsScreen' }] }],
    },
  ],
} as OrbitalSchema;

function gatedLoader(): { loader: SchemaLoader; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loader: SchemaLoader = {
    async load(importPath): Promise<LoadResult<LoadedSchema>> {
      await gate;
      return { success: true, data: { schema: docs, sourcePath: importPath, importPath } };
    },
    async loadOrbital() {
      throw new Error('lazy pages load whole schemas');
    },
    resolvePath: (importPath) => ({ success: true, data: importPath }),
    clearCache: () => undefined,
    getCacheStats: () => ({ size: 0 }),
  };
  return { loader, release: () => release() };
}

describe('OrbPreview lazy page swap', () => {
  it('keeps the current page on screen while the lazy page loads, then shows the lazy page', async () => {
    const { loader, release } = gatedLoader();
    render(<OrbPreview schema={site} lazyLoader={loader} isolated />);
    fireEvent.click(await screen.findByText('Open docs'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Home page')).toBeTruthy();
    expect(screen.queryByText('Docs page')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByText('Docs page')).toBeTruthy());
    expect(screen.queryByText('Home page')).toBeNull();
  });

  it('control: a preview that opens on a lazy page shows the loading state, not the first eager page', async () => {
    const { loader, release } = gatedLoader();
    render(<OrbPreview schema={site} lazyLoader={loader} initialPagePath="/docs" isolated />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Home page')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByText('Docs page')).toBeTruthy());
  });
});

function linkSite(href: string): OrbitalSchema {
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: 'site',
    version: '1.0.0',
    orbitals: [
      {
        name: 'Home',
        entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'HomeScreen',
            linkedEntity: 'Item',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [],
              transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'markdown-content', content: `[Read on](${href})` }]] }],
            },
          },
          {
            name: 'AboutScreen',
            linkedEntity: 'Item',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [],
              transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'About page' }]] }],
            },
          },
        ],
        pages: [
          { name: 'HomePage', path: '/', traits: [{ ref: 'HomeScreen' }] },
          { name: 'AboutPage', path: '/about', traits: [{ ref: 'AboutScreen' }] },
        ],
      },
    ],
    lazyPages: [docsPage],
  } as OrbitalSchema;
}

function countingLoader(): { loader: SchemaLoader; asked: string[] } {
  const asked: string[] = [];
  const { loader } = gatedLoader();
  return { loader: { ...loader, load: (importPath, fromPath) => { asked.push(importPath); return loader.load(importPath, fromPath); } }, asked };
}

describe('OrbPreview lazy page prefetch', () => {
  it('asks for a lazy page program when the pointer moves onto a link to it, once however often', async () => {
    const { loader, asked } = countingLoader();
    render(<OrbPreview schema={linkSite('/docs')} lazyLoader={loader} isolated />);
    const link = await screen.findByText('Read on');
    expect(asked).toEqual([]);
    fireEvent.pointerOver(link);
    fireEvent.pointerDown(link);
    fireEvent.pointerOver(link);
    expect(asked).toEqual(['lazy/Docs.orb']);
  });

  it('control: a link to one of the schema\'s own pages asks for nothing', async () => {
    const { loader, asked } = countingLoader();
    render(<OrbPreview schema={linkSite('/about')} lazyLoader={loader} isolated />);
    const link = await screen.findByText('Read on');
    fireEvent.pointerOver(link);
    fireEvent.pointerDown(link);
    expect(asked).toEqual([]);
  });
});
