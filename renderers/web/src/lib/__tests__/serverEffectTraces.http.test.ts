import { describe, it, expect } from 'vitest';
import type { ServerEffectResult } from '@almadar/core';
import { serverEffectTraces } from '../verificationRegistry';

describe('serverEffectTraces for an http effect', () => {
  it('carries the target and the routed failure event onto the trace', () => {
    const results: ServerEffectResult[] = [
      { effect: 'http', success: false, target: 'GET https://api.example.com/search', error: 'verify has no network', routed: 'ERR' },
      { effect: 'http', success: false, error: 'not in egress' },
    ];
    expect(serverEffectTraces(results)).toEqual([
      { type: 'http', outcome: 'failed', args: [], status: 'failed', error: 'verify has no network', target: 'GET https://api.example.com/search', routed: 'ERR' },
      { type: 'http', outcome: 'failed', args: [], status: 'failed', error: 'not in egress' },
    ]);
  });
});
