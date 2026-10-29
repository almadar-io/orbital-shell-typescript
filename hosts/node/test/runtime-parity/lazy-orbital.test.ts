import './helpers/kernel-evaluator.setup.js';
/**
 * `uses lazy` on the node host (EXEC-LOAD-2): registering the program from its file reads no lazy file; the first request
 * that names the lazy orbital registers it and the kernel loads the same file on that dispatch. Twin of the Rust host's
 * `a_booted_program_loads_its_lazy_orbital_from_the_file_beside_it_on_the_first_event`.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { OrbitalServerRuntime } from '../../src/runtime/OrbitalServerRuntime.js';
import { describeWithMemoryKernel, memoryKernel, nativeMemory } from './helpers/native-memory.js';

function lazyOrbital(): OrbitalSchema {
  return {
    name: 'Late',
    typeContractVersion: 1,
    schemaVersion: 4,
    orbitals: [
      {
        name: 'Late',
        entity: { name: 'Memo', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Hear',
            linkedEntity: 'Memo',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }, { name: 'heard' }],
              events: [],
              transitions: [{ from: 'idle', to: 'heard', event: 'HEARD', effects: [] }],
            },
          },
        ],
        pages: [],
      },
    ],
  };
}

function importer(): OrbitalSchema {
  return {
    name: 'App',
    typeContractVersion: 1,
    schemaVersion: 4,
    orbitals: [
      {
        name: 'Main',
        entity: { name: 'Note', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Home',
            linkedEntity: 'Note',
            stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [] }] },
          },
        ],
        pages: [],
      },
    ],
    lazyPages: [{ path: '/late', orbital: 'Late', orbRef: 'lazy/Late.orb', traits: [{ name: 'Hear', dispatchMode: 'persistedAwaited' }] }],
  };
}

function files(withLazyFile: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbital-node-lazy-'));
  mkdirSync(join(dir, 'lazy'));
  writeFileSync(join(dir, 'app.orb'), JSON.stringify(importer()));
  if (withLazyFile) writeFileSync(join(dir, 'lazy/Late.orb'), JSON.stringify(lazyOrbital()));
  return join(dir, 'app.orb');
}

describeWithMemoryKernel('OrbitalServerRuntime — uses lazy', () => {
  it('registers the program without the lazy orbital and serves it on the first request that names it', async () => {
    const rt = new OrbitalServerRuntime({ debug: false, kernel: await memoryKernel(), persistence: await nativeMemory() });
    await rt.registerFromFile(files(true));
    expect(rt.hasOrbital('Late')).toBe(false);
    const response = await rt.processOrbitalEvent('Late', { event: 'HEARD', targetTrait: 'Hear' });
    expect(response.success).toBe(true);
    expect(rt.hasOrbital('Late')).toBe(true);
  });

  it('control: an orbital no lazy page names is still not found', async () => {
    const rt = new OrbitalServerRuntime({ debug: false, kernel: await memoryKernel(), persistence: await nativeMemory() });
    await rt.registerFromFile(files(true));
    const response = await rt.processOrbitalEvent('Nowhere', { event: 'HEARD', targetTrait: 'Hear' });
    expect(response.success).toBe(false);
    expect(response.error).toBe('Orbital not found: Nowhere');
  });

  it('a lazy file that is missing fails the request that names it, naming the file', async () => {
    const rt = new OrbitalServerRuntime({ debug: false, kernel: await memoryKernel(), persistence: await nativeMemory() });
    await rt.registerFromFile(files(false));
    const response = await rt.processOrbitalEvent('Late', { event: 'HEARD', targetTrait: 'Hear' });
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/lazy orbital "Late": lazy\/Late\.orb could not be read/);
  });
});
