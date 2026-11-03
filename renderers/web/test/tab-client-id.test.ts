import { afterEach, describe, expect, it, vi } from 'vitest';

describe('tab client id outside a secure context', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('mints on a plain-http page, where crypto.randomUUID is absent', async () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const { getTabClientId } = await import('../src/hooks/circuit/useCircuitKernel');
    const id = getTabClientId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(getTabClientId()).toBe(id);
  });

  it('control: two module loads are two tabs with distinct ids', async () => {
    const first = (await import('../src/hooks/circuit/useCircuitKernel')).getTabClientId();
    vi.resetModules();
    const second = (await import('../src/hooks/circuit/useCircuitKernel')).getTabClientId();
    expect(second).not.toBe(first);
  });
});
