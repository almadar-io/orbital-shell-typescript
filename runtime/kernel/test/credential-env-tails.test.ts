import { describe, expect, it } from 'vitest';
import { answerRequest, type KernelHostPorts } from '../src/kernel/host.js';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { createBrowserSecretPorts, createSecretPorts, envTailsOf, type SecretPorts } from '../src/kernel/secret-ports.js';

function ports(secretPorts: SecretPorts | undefined): KernelHostPorts {
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
    ...(secretPorts !== undefined ? { secretPorts } : {}),
  };
}

const scope = { orbital: 'Main' };
const FULL_VALUE = 'abcdefgh6789';
const ask = { kind: 'credentialEnvTails' as const, names: ['ENV_LONG', 'ENV_SHORT', 'ENV_UNSET', 'ENV_EMPTY'] };

describe('credentialEnvTails (twin of the Rust host_effects credential-list env tests)', () => {
  it('the node host answers the last four of a value of eight or more, none for a shorter one, and omits what is unset or empty', async () => {
    const env = { ENV_LONG: FULL_VALUE, ENV_SHORT: 'abcde', ENV_EMPTY: '', OTHER: 'zzzzzzzzzzzz' };
    const answer = await answerRequest(ports({ ...createSecretPorts({ env: envTailsOf(env) }) }), ask, scope);
    expect(answer).toEqual({
      kind: 'credentialEnvTails',
      result: { ok: { kind: 'held', tails: [{ name: 'ENV_LONG', last4: '6789' }, { name: 'ENV_SHORT' }] } },
    });
    expect(JSON.stringify(answer)).not.toContain(FULL_VALUE);
  });

  it('control: a value of exactly eight characters has a tail and seven does not', () => {
    expect(envTailsOf({ A: '12345678', B: '1234567' })(['A', 'B'])).toEqual([{ name: 'A', last4: '5678' }, { name: 'B' }]);
  });

  it('a browser-role host answers a typed unsupported', async () => {
    const answer = await answerRequest(ports(createBrowserSecretPorts()), ask, scope);
    expect(answer).toEqual({ kind: 'credentialEnvTails', result: { ok: { kind: 'unsupported' } } });
  });

  it('a host given no secret ports answers a typed unsupported', async () => {
    expect(await answerRequest(ports(undefined), ask, scope)).toEqual({ kind: 'credentialEnvTails', result: { ok: { kind: 'unsupported' } } });
  });

  it('a failing environment read is the ask error, not an unsupported', async () => {
    const failing = ports({ ...createBrowserSecretPorts(), env: () => { throw new Error('env unreadable'); } });
    expect(await answerRequest(failing, ask, scope)).toEqual({ kind: 'credentialEnvTails', result: { error: 'env unreadable' } });
  });
});
