import { afterEach, expect, it, vi } from 'vitest';
import * as registry from '../verificationRegistry.js';

afterEach(() => { delete window.__orbitalVerification; });
const bridge = () => window.__orbitalVerification;

it('binds config application on a complete canonical verification bridge', async () => {
  delete window.__orbitalVerification;
  const apply = vi.fn();
  const unbind = registry.bindConfigApplier(apply);
  expect(bridge()?.getSnapshot().checks).toEqual([]);
  await bridge()?.applyConfig?.('Fixture', { title: 'Updated' });
  expect(apply).toHaveBeenCalledWith('Fixture', { title: 'Updated' });
  unbind();
  expect(bridge()?.applyConfig).toBeUndefined();
  expect(bridge()?.getSnapshot).toBeTypeOf('function');
});

it('an old owner cleanup cannot remove a newer config binding', () => {
  const old = registry.bindConfigApplier(vi.fn());
  const next = vi.fn();
  const dispose = registry.bindConfigApplier(next);
  old();
  expect(bridge()?.applyConfig).toBe(next);
  dispose();
  expect(bridge()?.applyConfig).toBeUndefined();
});
