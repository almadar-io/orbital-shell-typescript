import { describe, expect, it } from 'vitest';
import { answerRequest, HostAskError, hostAskReturn, parseSignInRequest, performHostAnswer, performHostAsk, type HostAudioAsk, type KernelHostPorts } from '../src/kernel/host.js';
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

describe('a client host answers a `host-ask` client effect with the same actions (G-ORB-589)', () => {
  it('performs each ask with its arguments and answers ok', async () => {
    const seen: string[] = [];
    const actions = { audio: (a: HostAudioAsk) => { seen.push(a.op); }, signOut: () => { seen.push('sign-out'); } };
    expect(await performHostAsk(actions, 'auth/sign-out', [])).toEqual({ ok: null });
    expect(await performHostAsk(actions, 'audio/play-sound', ['footstep'])).toEqual({ ok: null });
    expect(seen).toEqual(['sign-out', 'audio/play-sound']);
  });

  it('control: an ask the host cannot answer, or answers badly, is refused by name', async () => {
    expect(await performHostAsk(undefined, 'auth/sign-out', [])).toEqual({ error: 'no host sign-out is configured for auth/sign-out' });
    expect(await performHostAsk({}, 'audio/stop-music', [])).toEqual({ error: 'no host audio is configured for audio/stop-music' });
    expect(await performHostAsk({ audio: () => undefined }, 'browser/clipboard-write', ['x'])).toEqual({ error: 'no host action is configured for browser/clipboard-write' });
    expect(await performHostAsk({ signOut: () => { throw new Error('offline'); } }, 'auth/sign-out', [])).toEqual({ error: 'offline' });
  });
});

describe('auth/sign-in: the host ask whose answer returns to the asking trait (EXEC-DIST-13)', () => {
  const completion = { trait: 'SignIn', key: 'k1', success: 'SIGNED_IN', failure: 'SIGN_IN_FAILED' };

  it('parses each method to its one request and refuses every other shape by name', () => {
    expect(parseSignInRequest([{ method: 'google' }])).toEqual({ request: { method: 'google' } });
    expect(parseSignInRequest([{ method: 'email', email: 'a@b.c', password: 'pw' }])).toEqual({ request: { method: 'email', email: 'a@b.c', password: 'pw' } });
    expect(parseSignInRequest([{ method: 'emailLink', email: 'a@b.c', continueUrl: 'https://x/sign-in' }])).toEqual({ request: { method: 'emailLink', email: 'a@b.c', continueUrl: 'https://x/sign-in' } });
    expect(parseSignInRequest([{ method: 'emailLink', email: 'a@b.c', link: 'https://x/?oob=1' }])).toEqual({ request: { method: 'emailLink', email: 'a@b.c', link: 'https://x/?oob=1' } });
    expect(parseSignInRequest([{ method: 'customToken', token: 't' }])).toEqual({ request: { method: 'customToken', token: 't' } });
    for (const wrong of [[], [{ method: 'sms' }], [{ method: 'google', email: 'a@b.c' }], [{ method: 'email', email: 'a@b.c' }], [{ method: 'emailLink', email: 'a@b.c' }], [{ method: 'emailLink', email: 'a@b.c', continueUrl: 'u', link: 'l' }], [{ method: 'customToken' }], [{ method: 'google' }, 'x']]) {
      expect('error' in parseSignInRequest(wrong)).toBe(true);
    }
  });

  it('answers a success with the viewer and the key, and a failure with { error, kind, key } on the declared routes', async () => {
    const ok = await performHostAnswer({ signIn: async () => ({ uid: 'u1', email: 'a@b.c' }) }, 'auth/sign-in', [{ method: 'google' }]);
    expect(ok).toEqual({ ok: { uid: 'u1', email: 'a@b.c' } });
    expect(hostAskReturn(completion, ok)).toEqual({ trait: 'SignIn', event: 'SIGNED_IN', payload: { uid: 'u1', email: 'a@b.c', key: 'k1' } });
    const denied = await performHostAnswer({ signIn: async () => { throw new HostAskError('denied', 'wrong password'); } }, 'auth/sign-in', [{ method: 'google' }]);
    expect(denied).toEqual({ error: 'wrong password', kind: 'denied' });
    expect(hostAskReturn(completion, denied)).toEqual({ trait: 'SignIn', event: 'SIGN_IN_FAILED', payload: { error: 'wrong password', kind: 'denied', key: 'k1' } });
    expect(hostAskReturn({ trait: 'SignIn', entityId: 'row-1', success: 'SIGNED_IN' }, ok)).toEqual({ trait: 'SignIn', entityId: 'row-1', event: 'SIGNED_IN', payload: { uid: 'u1', email: 'a@b.c' } });
  });

  it('control: an outcome whose route the ask did not declare fires nothing, and a host with no sign-in fails unavailable', async () => {
    expect(hostAskReturn({ trait: 'SignIn', success: 'SIGNED_IN' }, { error: 'x', kind: 'denied' })).toBeUndefined();
    expect(await performHostAnswer({}, 'auth/sign-in', [{ method: 'google' }])).toEqual({ error: 'no host sign-in is configured for auth/sign-in', kind: 'unavailable' });
    expect(await performHostAnswer({ signIn: async () => ({ sent: true }) }, 'auth/sign-in', [{ method: 'email' }])).toMatchObject({ kind: 'invalid' });
    expect(await performHostAnswer({ signIn: async () => ({ sent: true }) }, 'auth/sign-in', [{ method: 'emailLink', email: 'a@b.c', continueUrl: 'u' }])).toEqual({ ok: { sent: true } });
  });
});
