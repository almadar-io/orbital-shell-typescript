// A leg the client runs against a local store (browser-stored entities, the offline
// preview) evaluates `i18n/t` like any server: with the viewer's catalog. The kernel
// had it but the local transports did not, so a translated render in such a leg
// (std-app-layout's `appName`) failed the mount.
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { ENGINES, loadTestKernel, TEST_TYPE_CONTRACT_VERSION, TEST_STAMP } from '../../src/test-support/kernel-engine';
import { nativeMemoryPersistence } from '../../src/runtime';
import { I18nProvider, createTranslate } from '../../src/core';

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'Main', pages: [],
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

const binding: ResolvedTraitBinding = {
  trait: {
    name: 'Shell', source: 'schema', states: [{ name: 'idle', isInitial: true, isFinal: false }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [] }], guards: [], ticks: [], listens: [], dataEntities: [],
  },
};

const messages = { 'app:name': 'Northwind CRM' };
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider value={{ locale: 'en', direction: 'ltr', t: createTranslate(messages, 'en'), messages }}>{children}</I18nProvider>
);

describe.each(ENGINES)('a local-store leg translates with the viewer catalog [%s engine]', (_name, engine) => {
  it('the offline transport mounts a trait whose leg renders translated text', async () => {
    const persistence = nativeMemoryPersistence(await loadTestKernel());
    const { result } = renderHook(() => useCircuitKernel([binding], { stamp: TEST_STAMP, orbitals, persistence, engine }), { wrapper });
    const outcome = await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Shell' });
    expect(outcome.response.success).toBe(true);
  });
});
