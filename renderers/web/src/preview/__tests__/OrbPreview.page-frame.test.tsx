/**
 * A preview that is the host page (a served app) lays its slots out on the page: the dock is fixed to the viewport
 * and pushes the body. A preview inside a host's box keeps its slots in that box.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

const schema: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'docked-app',
  version: '1.0.0',
  orbitals: [{
    name: 'Docked',
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'Panel',
      linkedEntity: 'Item',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'dock', { type: 'typography', content: 'docked body' }]] }],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Panel' }] }],
  }],
};

const inset = () => document.documentElement.style.getPropertyValue('--almadar-dock-inset');

function stubDesktop(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--almadar-dock-inset');
});

describe('OrbPreview — frame', () => {
  it('page: the dock is fixed to the viewport and pushes the page', async () => {
    stubDesktop();
    render(<OrbPreview schema={schema} isolated height="auto" frame="page" />);
    const dock = await screen.findByRole('complementary');
    expect(screen.getByText('docked body')).toBeInTheDocument();
    expect(dock.className).toMatch(/\bfixed\b/);
    expect(inset()).toBe('384px');
  });

  it('control: by default the dock stays inside the preview box and leaves the page alone', async () => {
    stubDesktop();
    render(<OrbPreview schema={schema} isolated />);
    const dock = await screen.findByRole('complementary');
    expect(dock.className).toMatch(/\babsolute\b/);
    expect(inset()).toBe('');
  });
});
