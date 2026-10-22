import { describe, expect, it } from 'vitest';
import type { BrowserPageFacts, PageFactField } from '@almadar/core';
import { answerRequest, type KernelHostPorts } from '../src/kernel/host.js';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';

function ports(pageFacts?: KernelHostPorts['pageFacts']): KernelHostPorts {
  return {
    persistence: {
      create: async () => { throw new Error('unexpected store call'); },
      update: async () => { throw new Error('unexpected store call'); },
      delete: async () => { throw new Error('unexpected store call'); },
      getById: async () => { throw new Error('unexpected store call'); },
      list: async () => { throw new Error('unexpected store call'); },
    },
    callService: async () => null,
    programEffect: () => undefined,
    inFlightCalls: new InFlightCalls(),
    servicePorts: () => { throw new Error('unexpected service call'); },
    deliverLive: () => undefined,
    deferCallOutcome: () => undefined,
    ...(pageFacts !== undefined ? { pageFacts } : {}),
  };
}

const request = { kind: 'pageFacts' as const, fields: ['hostname', 'screenWidth'] satisfies PageFactField[] };
const scope = { orbital: 'Main' };

describe('renderer-neutral page facts port', () => {
  it('reports unavailable without a page host', async () => {
    expect(await answerRequest(ports(), request, scope)).toEqual({
      kind: 'pageFacts',
      result: { ok: { available: false, hostname: '', referrer: '', screenWidth: null } },
    });
  });

  it('hands fields to the injected page host and preserves its facts', async () => {
    const seen: (readonly PageFactField[])[] = [];
    const facts: BrowserPageFacts = { available: true, hostname: 'example.test', referrer: '', screenWidth: 1200 };
    expect(await answerRequest(ports((fields) => { seen.push(fields); return facts; }), request, scope)).toEqual({ kind: 'pageFacts', result: { ok: facts } });
    expect(seen).toEqual([request.fields]);
  });

  it('preserves a page host failure through the kernel result contract', async () => {
    expect(await answerRequest(ports(() => { throw new Error('page unavailable'); }), request, scope)).toEqual({ kind: 'pageFacts', result: { error: 'page unavailable' } });
  });
});
