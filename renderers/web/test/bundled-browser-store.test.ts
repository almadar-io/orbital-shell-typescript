/**
 * `openBundledBrowserStore` hands the resolved program to the kernel, which validates it on register: the host never
 * parses it (G-ORBITAL-SHELL-TYPESCRIPT-088, a 37 MB program ran `parseOrbitalSchema` out of a 4 GB heap).
 */
import { describe, expect, it } from 'vitest';
import { parseOrbitalSchema, type OrbitalSchema } from '@almadar/core';
import { openBundledBrowserStore } from '../src/runtime/index.js';
import { KERNEL_AVAILABLE, TEST_LANGUAGE, loadTestKernel } from '../src/test-support/kernel-engine.js';

const unparsable: OrbitalSchema = JSON.parse('{"name":5,"orbitals":[]}');

describe.skipIf(!KERNEL_AVAILABLE)('openBundledBrowserStore', () => {
  it('opens the program as given, without a parse of its own', async () => {
    const kernel = await loadTestKernel();
    await expect(openBundledBrowserStore(unparsable, kernel, TEST_LANGUAGE)).rejects.toThrow('declares no browser-stored entity');
  });

  it('control: the zod parse the host used to run refuses the same program', () => {
    expect(() => parseOrbitalSchema(unparsable)).toThrow();
  });
});
