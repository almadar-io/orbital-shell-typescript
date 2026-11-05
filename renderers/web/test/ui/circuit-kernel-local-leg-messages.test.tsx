// A leg the client runs against a local store (browser-stored entities, the offline
// preview) evaluates `i18n/t` like any server: with the viewer's catalog. The kernel
// had it but the local transports did not, so a translated render in such a leg
// (std-app-layout's `appName`) failed the mount.
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { ENGINES, loadTestKernel, TEST_TYPE_CONTRACT_VERSION, TEST_STAMP } from '../../src/test-support/kernel-engine';
import { nativeMemoryPersistence } from '../../src/runtime';
import { I18nProvider, createTranslate } from '../../src/core';
import { circuitReady } from '../../src/test-support/circuit';

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'Main', pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Shell' }] }],
  entity: { name: 'Note', persistence: 'persistent', collection: 'notes', fields: [{ name: 'id', type: 'string' }] },
  traits: [{
    name: 'Shell', linkedEntity: 'Note',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }], events: [],
      transitions: [
        { from: 'idle', to: 'idle', event: 'INIT', effects: [['fetch', 'Note', {}], ['render-ui', 'main', { type: 'typography', content: ['i18n/t', 'app:name'] }]] },
      ],
    },
  }],
}];

const messages = { 'app:name': 'Northwind CRM' };
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider value={{ locale: 'en', direction: 'ltr', t: createTranslate(messages, 'en'), messages }}>{children}</I18nProvider>
);

describe.each(ENGINES)('a local-store leg translates with the viewer catalog [%s engine]', (_name, engine) => {
  it('the offline transport mounts a trait whose leg renders translated text', async () => {
    const persistence = nativeMemoryPersistence(await loadTestKernel());
    const { result } = renderHook(() => useCircuitKernel({ stamp: TEST_STAMP, orbitals, persistence, engine }), { wrapper });
    await circuitReady(result);
    const outcome = await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Shell' });
    expect(outcome.response.success).toBe(true);
  });
});

const catalogs: Record<string, Record<string, string>> = { en: { 'app:name': 'Northwind CRM' }, ar: { 'app:name': 'نورثويند' } };
const switchable = ({ children, locale }: { children: React.ReactNode; locale: string }) => (
  <I18nProvider value={{ locale, direction: locale === 'ar' ? 'rtl' : 'ltr', t: createTranslate(catalogs[locale], locale), messages: catalogs[locale] }}>{children}</I18nProvider>
);

describe.each(ENGINES)('a locale switch keeps the local legs open [%s engine]', (_name, engine) => {
  it('the transport and kernel client survive the switch, and the next render is in the new catalog', async () => {
    const persistence = nativeMemoryPersistence(await loadTestKernel());
    let current = 'en';
    const { result, rerender } = renderHook(() => useCircuitKernel({ stamp: TEST_STAMP, orbitals, persistence, engine }), {
      wrapper: ({ children }) => switchable({ children, locale: current }),
    });
    await circuitReady(result);
    const before = { transport: result.current.transport, engine: result.current.engine };
    current = 'ar';
    rerender();
    await circuitReady(result);
    expect(result.current.transport).toBe(before.transport);
    expect(result.current.engine).toBe(before.engine);
    const outcome = await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Shell' });
    expect(JSON.stringify(outcome.response)).toContain('نورثويند');
    expect(JSON.stringify(outcome.response)).not.toContain('Northwind CRM');
  });

  it('control: a different persistence opens a new local leg', async () => {
    const kernel = await loadTestKernel();
    const { result, rerender } = renderHook(({ persistence }) => useCircuitKernel({ stamp: TEST_STAMP, orbitals, persistence, engine }), {
      wrapper, initialProps: { persistence: nativeMemoryPersistence(kernel) },
    });
    await circuitReady(result);
    const before = result.current.transport;
    rerender({ persistence: nativeMemoryPersistence(kernel) });
    await circuitReady(result);
    expect(result.current.transport).not.toBe(before);
  });
});
