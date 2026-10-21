import { describe, expect, it } from 'vitest';
import { InMemoryPersistence } from '@almadar/db/mock';
import { captureFallbackNotices, LatencyPersistence, PlainPersistence } from '../src/persistence-wrappers.js';

describe('persistence wrappers', () => {
  it('LatencyPersistence forwards the optional members the inner adapter declares', () => {
    const wrapped = new LatencyPersistence(new InMemoryPersistence(), 0);
    expect(typeof wrapped.writeWhere).toBe('function');
    expect(typeof wrapped.writeCapabilities).toBe('function');
    expect(typeof wrapped.queryPage).toBe('function');
  });

  it('control: PlainPersistence declares none of them, and LatencyPersistence over it forwards none', () => {
    const plain = new PlainPersistence(new InMemoryPersistence());
    expect(Object.keys(plain)).not.toContain('writeWhere');
    const wrapped = new LatencyPersistence(plain, 0);
    expect(wrapped.writeWhere).toBeUndefined();
    expect(wrapped.queryPage).toBeUndefined();
  });

  it('counts fallback notices by kind and reason, console and JSON forms, and passes other output through', async () => {
    const { notices } = await captureFallbackNotices(async () => {
      console.warn('[almadar:runtime:pushdown]', 'kernel.write.pushdown-fallback', { reason: 'no-write-capability' });
      console.log(JSON.stringify({ message: 'kernel.fetch.pushdown-fallback', data: { reason: 'not-expressible' } }));
      console.warn('[x]', 'something else', {});
    });
    expect(notices).toEqual({ 'kernel.write.pushdown-fallback:no-write-capability': 1, 'kernel.fetch.pushdown-fallback:not-expressible': 1 });
  });
});
