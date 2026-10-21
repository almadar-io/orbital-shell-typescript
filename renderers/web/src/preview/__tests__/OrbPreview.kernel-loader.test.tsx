/**
 * A host hands `OrbPreview` the kernel loader, and the preview runs its circuits on the kernel (which installs the
 * render evaluator). With neither a loader nor a `KernelEngineProvider` above it, the preview refuses to run.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { I18nProvider, createTranslate } from '../../core';
import { KernelLoaderMissingError } from '../../providers/KernelEngineContext';
import { KERNEL_AVAILABLE, TEST_LANGUAGE, loadFreshClientKernel, loadTestKernel } from '../../test-support/kernel-engine';

// The provider's own contract: the shared setup's test kernel is not used here.
vi.unmock('../../providers/KernelEngineContext');

const schema = (name: string): OrbitalSchema => JSON.parse(JSON.stringify({
  name,
  version: '1.0.0',
  orbitals: [{
    name: 'Books',
    entity: { name: 'Invoice', persistence: 'runtime', fields: [{ name: 'id', type: 'string', required: true }] },
    traits: [{
      name: 'Greeter', scope: 'instance', linkedEntity: 'Invoice',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'hello kernel' }]] }],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Greeter' }] }],
  }],
}));

const describeKernel = KERNEL_AVAILABLE ? describe : describe.skip;

describeKernel('OrbPreview — kernelLoader', () => {
  it('loads the kernel for the preview when the host supplies a loader', async () => {
    const loader = vi.fn(() => loadTestKernel());
    render(<OrbPreview schema={schema(`kernel-loader-${Math.random()}`)} isolated kernelLoader={loader} />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('hello kernel')).toBeTruthy();
  }, 20_000);

  it('control: with no loader and no provider the preview refuses to run, naming the missing loader', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<OrbPreview schema={schema(`kernel-loader-${Math.random()}`)} isolated />)).toThrow(KernelLoaderMissingError);
    quiet.mockRestore();
  });
});

const board = (name: string): OrbitalSchema => JSON.parse(JSON.stringify({
  name,
  version: '1.0.0',
  orbitals: [{
    name: 'Board',
    entity: {
      name: 'Task', persistence: 'persistent', collection: 'tasks', local: true,
      fields: [{ name: 'id', type: 'string', required: true }, { name: 'title', type: 'string' }, { name: 'owner', type: 'relation', relation: { entity: 'Person' } }],
      instances: [{ id: 't-1', title: 'Write the brief', owner: 'p-1' }],
    },
    auxiliaryEntities: [{
      name: 'Person', persistence: 'persistent', collection: 'people', local: true,
      fields: [{ name: 'id', type: 'string', required: true }, { name: 'name', type: 'string' }],
      instances: [{ id: 'p-1', name: 'Maja' }],
    }],
    traits: [{
      name: 'TaskGrid', scope: 'collection', linkedEntity: 'Task',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [{ key: 'LOADED', name: 'LOADED', payloadSchema: [{ name: 'data', type: 'array' }] }],
        transitions: [
          { from: 'idle', to: 'idle', event: 'INIT', effects: [['fetch', 'Task', { emit: { success: 'LOADED' } }]] },
          { from: 'idle', to: 'idle', event: 'LOADED', effects: [['render-ui', 'main', { type: 'stack', children: [
            { type: 'typography', content: 'board ready' },
            { type: 'data-grid', entity: '@payload.data', fields: ['title', 'owner'] },
          ] }]] },
        ],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'TaskGrid' }] }],
  }],
}));

describeKernel('OrbPreview — languageLoader', () => {
  it('opens the kernel over browser-stored rows with the language the host loads', async () => {
    const language = vi.fn(() => Promise.resolve(TEST_LANGUAGE));
    render(<OrbPreview schema={board(`language-loader-${Math.random()}`)} isolated kernelLoader={loadFreshClientKernel} languageLoader={language} />);
    expect(await screen.findByText('board ready', undefined, { timeout: 15_000 })).toBeTruthy();
    expect(language).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('control: with no language loader the mount fails naming it, not with a trap', async () => {
    render(<OrbPreview schema={board(`language-loader-${Math.random()}`)} isolated kernelLoader={loadFreshClientKernel} />);
    expect(await screen.findByText(/No language loader/, undefined, { timeout: 15_000 })).toBeTruthy();
    expect(screen.queryByText('unreachable')).toBeNull();
  }, 20_000);
});

const greeting = (name: string): OrbitalSchema => JSON.parse(JSON.stringify({
  name,
  version: '1.0.0',
  orbitals: [{
    name: 'Site',
    entity: { name: 'SiteView', persistence: 'runtime', fields: [{ name: 'id', type: 'string', required: true }] },
    traits: [{
      name: 'Hero', scope: 'instance', linkedEntity: 'SiteView',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: ['i18n/t', 'site:hero.title'] }]] }],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Hero' }] }],
  }],
}));

describeKernel('OrbPreview — the client kernel paints i18n/t', () => {
  it('from the catalog of the viewer the host provides', async () => {
    const messages = { 'site:hero.title': 'Hello from the catalog' };
    render(
      <I18nProvider value={{ locale: 'en', direction: 'ltr', t: createTranslate(messages), messages }}>
        <OrbPreview schema={greeting(`i18n-${Math.random()}`)} isolated kernelLoader={loadFreshClientKernel} languageLoader={() => Promise.resolve(TEST_LANGUAGE)} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Hello from the catalog', undefined, { timeout: 15_000 })).toBeTruthy();
  }, 20_000);

  it('control: with no catalog the paint fails, naming the message it lacks', async () => {
    render(<OrbPreview schema={greeting(`i18n-${Math.random()}`)} isolated kernelLoader={loadFreshClientKernel} />);
    expect(await screen.findByText(/no `null` message for `site:hero\.title`/, undefined, { timeout: 15_000 })).toBeTruthy();
    expect(screen.queryByText('Hello from the catalog')).toBeNull();
  }, 20_000);
});
