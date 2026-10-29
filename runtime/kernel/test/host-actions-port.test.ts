import { describe, expect, it } from 'vitest';
import { answerRequest, type HostAudioAsk, type KernelHostPorts } from '../src/kernel/host.js';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';

function ports(hostActions?: KernelHostPorts['hostActions']): KernelHostPorts {
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
    ...(hostActions !== undefined ? { hostActions } : {}),
  };
}

const scope = { orbital: 'Main' };
const ask = (op: string, args: string[] = []) => ({ kind: 'substrate' as const, op, args, key: undefined, site: undefined });
const ok = { kind: 'substrate', result: { ok: null } };

describe('renderer-neutral audio and sign-out asks (twin of the Rust substrate-ask test)', () => {
  it('hands each audio ask to the host with its key, absent where the op names none', async () => {
    const seen: HostAudioAsk[] = [];
    const host = ports({ audio: (a) => { seen.push(a); } });
    for (const [op, args] of [['audio/play-sound', ['footstep']], ['audio/stop-sound', ['footstep']], ['audio/stop-sound', []], ['audio/change-music', ['theme']], ['audio/change-music', []], ['audio/stop-music', []]] as const) {
      expect(await answerRequest(host, ask(op, [...args]), scope)).toEqual(ok);
    }
    expect(seen).toEqual([
      { op: 'audio/play-sound', key: 'footstep' },
      { op: 'audio/stop-sound', key: 'footstep' },
      { op: 'audio/stop-sound', key: undefined },
      { op: 'audio/change-music', key: 'theme' },
      { op: 'audio/change-music', key: undefined },
      { op: 'audio/stop-music' },
    ]);
  });

  it('runs the host sign-out with no payload', async () => {
    let signedOut = 0;
    expect(await answerRequest(ports({ signOut: () => { signedOut += 1; } }), ask('auth/sign-out'), scope)).toEqual(ok);
    expect(signedOut).toBe(1);
  });

  it('control: a host with no audio or sign-out refuses each ask by name instead of doing nothing', async () => {
    const refused = await answerRequest(ports(), ask('audio/play-sound', ['footstep']), scope);
    expect(refused).toEqual({ kind: 'substrate', result: { error: { message: 'no host audio is configured for audio/play-sound', errors: [] } } });
    const noSignOut = await answerRequest(ports({ audio: () => undefined }), ask('auth/sign-out'), scope);
    expect(noSignOut).toEqual({ kind: 'substrate', result: { error: { message: 'no host sign-out is configured for auth/sign-out', errors: [] } } });
  });

  it('control: a play-sound with no key, or an extra argument, is refused before the host hears it', async () => {
    const seen: HostAudioAsk[] = [];
    const host = ports({ audio: (a) => { seen.push(a); } });
    const noKey = await answerRequest(host, ask('audio/play-sound'), scope);
    expect(noKey).toMatchObject({ result: { error: { message: 'audio/play-sound: the key must be one non-empty text' } } });
    const extra = await answerRequest(host, ask('audio/stop-music', ['x']), scope);
    expect(extra).toMatchObject({ result: { error: { message: 'audio/stop-music takes no arguments' } } });
    expect(seen).toEqual([]);
  });
});
