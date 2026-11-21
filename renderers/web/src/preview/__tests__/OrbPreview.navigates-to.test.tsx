// @vitest-environment jsdom
/**
 * A `navigatesTo` action rendered inside a trait (page-header actions,
 * shell top-bar actions, item actions) navigates through the nav stack the
 * preview mounts; the preview must switch to the target page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function schema(action: Record<string, string>): OrbitalSchema {
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: 'nav-to-app',
    version: '1.0.0',
    orbitals: [
      {
        name: 'NavOrbital',
        entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Home',
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

function effectSchema(target: string): OrbitalSchema {
  const base = schema({ label: 'Go', event: 'GO' });
  const home = base.orbitals[0].traits[0];
  if (typeof home === 'string' || !('stateMachine' in home) || home.stateMachine === undefined) throw new Error('fixture: Home has no state machine');
  home.stateMachine.events = [{ key: 'GO', name: 'GO' }];
  home.stateMachine.transitions.push({ from: 'idle', to: 'idle', event: 'GO', effects: [['navigate', target]] });
  return base;
}

describe('OrbPreview navigate effect to an address outside the app', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a mailto address is opened by the browser and the page stays', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<OrbPreview schema={effectSchema('mailto:hello@example.com?subject=A%20call')} isolated />);
    fireEvent.click(await screen.findByText('Go'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('mailto:hello@example.com?subject=A%20call', '_self', 'noopener'));
    expect(screen.getByText('Home page')).toBeTruthy();
    expect(screen.queryByText('Start page')).toBeNull();
  });

  it('an https address opens in a new tab from a sandboxed preview', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<OrbPreview schema={effectSchema('https://example.com/book')} isolated />);
    fireEvent.click(await screen.findByText('Go'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.com/book', '_blank', 'noopener'));
    expect(screen.getByText('Home page')).toBeTruthy();
  });

  it('control: a path still opens the page inside the app', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<OrbPreview schema={effectSchema('/start')} isolated />);
    fireEvent.click(await screen.findByText('Go'));
    await waitFor(() => expect(screen.getByText('Start page')).toBeTruthy());
    expect(open).not.toHaveBeenCalled();
  });
});
