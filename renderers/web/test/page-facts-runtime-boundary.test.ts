import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerRequest as answerWebRequest } from '../src/kernel/host.js';
import { answerRequest as answerRuntimeRequest, type KernelHostPorts } from '@almadar/shell-runtime/kernel/host';
import { InFlightCalls } from '@almadar/shell-runtime/effects/in-flight-calls';

function ports(): KernelHostPorts {
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
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('web runtime page host compatibility', () => {
  it('keeps browser facts in the web facade while shared runtime requires an injected host', async () => {
    vi.stubGlobal('window', { location: { hostname: 'app.example' }, screen: { width: 1440 } });
    vi.stubGlobal('document', { referrer: 'https://example.test/' });
    const request = { kind: 'pageFacts' as const, fields: ['hostname', 'referrer', 'screenWidth'] as const };
    const ask = { ...request, fields: [...request.fields] };
    const scope = { orbital: 'Main' };
    expect(await answerWebRequest(ports(), ask, scope)).toEqual({
      kind: 'pageFacts', result: { ok: { available: true, hostname: 'app.example', referrer: 'https://example.test/', screenWidth: 1440 } },
    });
    expect(await answerRuntimeRequest(ports(), ask, scope)).toEqual({
      kind: 'pageFacts', result: { ok: { available: false, hostname: '', referrer: '', screenWidth: null } },
    });
  });
});
