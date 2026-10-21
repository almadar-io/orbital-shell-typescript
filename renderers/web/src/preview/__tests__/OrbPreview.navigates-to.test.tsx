// @vitest-environment jsdom
/**
 * A `navigatesTo` action rendered inside a trait (page-header actions,
 * shell top-bar actions, item actions) emits `UI:NAVIGATE`; the preview must
 * switch to the target page. The emit happens on the bus OrbitalProvider
 * mounts, so the preview has to listen inside that tree.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function schema(action: Record<string, string>): OrbitalSchema {
  return {
    name: 'nav-to-app',
    version: '1.0.0',
    orbitals: [
      {
        name: 'NavOrbital',
        entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Home',
            scope: 'instance',
            linkedEntity: 'Item',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [],
              transitions: [
                { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'page-header', title: 'Home page', actions: [action] }]] },
              ],
            },
          },
          {
            name: 'Start',
            scope: 'instance',
            linkedEntity: 'Item',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [],
              transitions: [
                { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'Start page' }]] },
              ],
            },
          },
        ],
        pages: [
          { name: 'HomePage', path: '/', traits: [{ ref: 'Home' }] },
          { name: 'StartPage', path: '/start', traits: [{ ref: 'Start' }] },
        ],
      },
    ],
  } as OrbitalSchema;
}

describe('OrbPreview navigatesTo', () => {
  it('a page-header action with navigatesTo opens the target page', async () => {
    render(<OrbPreview schema={schema({ label: 'New path', navigatesTo: '/start' })} isolated />);
    fireEvent.click(await screen.findByText('New path'));
    await waitFor(() => expect(screen.getByText('Start page')).toBeTruthy());
  });

  it('control: an action with only an event stays on the page', async () => {
    render(<OrbPreview schema={schema({ label: 'New path', event: 'NOOP' })} isolated />);
    fireEvent.click(await screen.findByText('New path'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Start page')).toBeNull();
    expect(screen.getByText('Home page')).toBeTruthy();
  });
});
