import { describe, expect, it } from 'vitest';
import { createNodeOsHost } from '../src/os-node.js';

describe('the Node os host and gpu', () => {
  it('refuses every gpu op typed, in place and deferred, with the Rust host\'s text', async () => {
    const host = createNodeOsHost({ allows: () => true, globMatches: () => false, isPublicAddress: () => false, anchor: () => [], resolveArgs: (_op, args) => ({ ok: args }) });
    try {
      expect(await host.answer('gpu/buffer-create', [1, { size: 4, usage: ['storage'] }])).toEqual({ error: { kind: 'unsupported', message: 'gpu/buffer-create: this host has no gpu' } });
      expect(await host.answer('gpu/device-open', [{}])).toEqual({ error: { kind: 'unsupported', message: 'gpu/device-open: this host has no gpu' } });
      expect(host.defer?.('gpu/submit', [1, []], 'k', () => undefined)).toEqual({ error: { kind: 'unsupported', message: 'gpu/submit: this host has no gpu' } });
      expect(await host.answer('os/exists', ['/'])).not.toMatchObject({ error: { kind: 'unsupported' } });
    } finally { host.close(); }
  });
});
