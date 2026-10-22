import { describe, expect, it } from 'vitest';
import { SERVICES_REGISTRY, isBrowserOnlyService } from '../src/patterns/index.js';

describe('isBrowserOnlyService', () => {
  it('is true for exactly the services whose only declared runtime is the browser (none is declared today: G-CROSS-246)', () => {
    const browserOnly = Object.entries(SERVICES_REGISTRY.services).filter(([, entry]) => entry.runtimes.length === 1 && entry.runtimes[0] === 'browser').map(([name]) => name);
    expect(browserOnly).toEqual([]);
    for (const name of Object.keys(SERVICES_REGISTRY.services)) expect(isBrowserOnlyService(name), name).toBe(browserOnly.includes(name));
  });

  it('is false for a service that also runs on node, or only on node', () => {
    expect(isBrowserOnlyService('llm')).toBe(false);
    expect(isBrowserOnlyService('knowledge')).toBe(false);
    expect(isBrowserOnlyService('hosting')).toBe(false);
  });

  it('is false for a name the registry does not declare, or a binding', () => {
    expect(isBrowserOnlyService('no-such-service')).toBe(false);
    expect(isBrowserOnlyService('@config.service')).toBe(false);
    expect(isBrowserOnlyService('')).toBe(false);
  });
});
