// @vitest-environment jsdom
/**
 * The host owns the browser history: when the browser goes back or forward, the host hands OrbPreview the new
 * path and the page on screen follows it.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function orbital(name: string, path: string): OrbitalSchema['orbitals'][number] {
  return {
    name,
    entity: { name: `${name}State`, persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: `${name}View`,
      linkedEntity: `${name}State`,
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: `${name} page` }]] }],
      },
    }],
    pages: [{ name: `${name}Page`, path, traits: [{ ref: `${name}View` }], access: 'public', indexing: 'index', title: name }],
  } as OrbitalSchema['orbitals'][number];
}

const app: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'site',
  orbitals: [orbital('Home', '/home'), orbital('Path', '/paths/:graphId')],
};

describe('OrbPreview follows the host path', () => {
  it('a back to an earlier path shows that page again', async () => {
    const view = render(<MemoryRouter><OrbPreview schema={app} initialPagePath="/home" /></MemoryRouter>);
    await screen.findByText('Home page');
    view.rerender(<MemoryRouter><OrbPreview schema={app} initialPagePath="/paths/g1" /></MemoryRouter>);
    await screen.findByText('Path page');
    view.rerender(<MemoryRouter><OrbPreview schema={app} initialPagePath="/home" /></MemoryRouter>);
    await screen.findByText('Home page');
    expect(screen.queryByText('Path page')).toBeNull();
  });

  it('control: the same path handed again keeps the page on screen', async () => {
    const view = render(<MemoryRouter><OrbPreview schema={app} initialPagePath="/paths/g1" /></MemoryRouter>);
    await screen.findByText('Path page');
    view.rerender(<MemoryRouter><OrbPreview schema={app} initialPagePath="/paths/g1" /></MemoryRouter>);
    expect(await screen.findByText('Path page')).toBeTruthy();
  });
});
