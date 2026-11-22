// @vitest-environment jsdom
/**
 * Once the route's traits have mounted (their lifecycle seeds ran and painted), the preview says so with
 * `data-orb-mounted`: what prerender waits on before it reads the page, so a page that has not mounted yet is never
 * taken for one with nothing on it.
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

const app: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'site',
  orbitals: [{
    name: 'Home',
    entity: { name: 'HomeState', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'HomeView',
      linkedEntity: 'HomeState',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'Welcome home' }]] }],
      },
    }],
    pages: [{ name: 'HomePage', path: '/', traits: [{ ref: 'HomeView' }] }],
  } as OrbitalSchema['orbitals'][number]],
};

describe('the mounted route mark', () => {
  it('a page whose traits have mounted is marked with its route', async () => {
    const { container } = render(<MemoryRouter><OrbPreview schema={app} initialPagePath="/" /></MemoryRouter>);
    await screen.findByText('Welcome home');
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-orb-mounted]')?.getAttribute('data-orb-mounted')).toBe('/');
  });

  it('control: nothing is marked before the page has mounted', () => {
    const { container } = render(<MemoryRouter><OrbPreview schema={app} initialPagePath="/" /></MemoryRouter>);
    expect(container.querySelector('[data-orb-mounted]')).toBeNull();
  });
});
