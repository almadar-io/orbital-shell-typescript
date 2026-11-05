import { describe, expect, it } from 'vitest';
import { HostAskError } from '@almadar/shell-runtime/kernel/host';
import { consentByPopup, type ConsentPopup, type ConsentPopupEnv } from '../consent-popup';
import { answerHostAsk, registerHostConsent, webHostActions } from '../host-actions';

const AUTHORIZE = 'https://idp.example/authorize?state=s1';

function fakeEnv(steps: Array<string | 'cross-origin' | 'closed'>): { env: ConsentPopupEnv; opened: string[]; closedByHost: () => boolean } {
  const opened: string[] = [];
  let index = 0;
  let closedByHost = false;
  const popup: ConsentPopup = {
    get closed() { return steps[Math.min(index, steps.length - 1)] === 'closed' || closedByHost; },
    get location(): { href: string } {
      const step = steps[Math.min(index, steps.length - 1)];
      if (step === 'cross-origin' || step === 'closed') throw new DOMException('blocked a frame with another origin', 'SecurityError');
      return { href: step };
    },
    close() { closedByHost = true; },
  };
  const env: ConsentPopupEnv = {
    origin: 'https://app.example',
    open: (url) => { opened.push(url); return popup; },
    wait: async () => { index += 1; },
  };
  return { env, opened, closedByHost: () => closedByHost };
}

describe('auth/consent on the web host', () => {
  it('opens the authorize URL, waits through the provider pages, and answers the code and state of the redirect back to this origin', async () => {
    const { env, opened, closedByHost } = fakeEnv(['about:blank', 'cross-origin', 'cross-origin', 'https://app.example/cb?code=c1&state=s1']);
    expect(await consentByPopup(env)({ authorizeUrl: AUTHORIZE })).toEqual({ code: 'c1', state: 's1' });
    expect(opened).toEqual([AUTHORIZE]);
    expect(closedByHost()).toBe(true);
  });

  it('fails cancelled when the viewer closes the window, unavailable when the browser blocks it, denied when the redirect has no code', async () => {
    await expect(consentByPopup(fakeEnv(['cross-origin', 'closed']).env)({ authorizeUrl: AUTHORIZE })).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(consentByPopup({ origin: 'https://app.example', open: () => null, wait: async () => undefined })({ authorizeUrl: AUTHORIZE })).rejects.toBeInstanceOf(HostAskError);
    await expect(consentByPopup(fakeEnv(['https://app.example/cb?error=access_denied&state=s1']).env)({ authorizeUrl: AUTHORIZE })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('answers a host-ask through the installed consent and returns { code, state } to the asking trait; control: a failure returns { error, kind }', async () => {
    const dispatched: Array<[string, string, unknown]> = [];
    const dispatch = async (trait: string, event: string, payload: unknown): Promise<void> => { dispatched.push([trait, event, payload]); };
    const completion = { trait: 'Consent', key: 'k1', success: 'CONSENT_GRANTED', failure: 'CONSENT_FAILED' };
    const off = registerHostConsent(async () => ({ code: 'c1', state: 's1' }));
    await answerHostAsk('auth/consent', [{ authorizeUrl: AUTHORIZE }], completion, dispatch);
    off();
    const offFailing = registerHostConsent(async () => { throw new HostAskError('cancelled', 'closed'); });
    await answerHostAsk('auth/consent', [{ authorizeUrl: AUTHORIZE }], completion, dispatch);
    offFailing();
    expect(dispatched).toEqual([
      ['Consent', 'CONSENT_GRANTED', { code: 'c1', state: 's1', key: 'k1' }],
      ['Consent', 'CONSENT_FAILED', { error: 'closed', kind: 'cancelled', key: 'k1' }],
    ]);
    expect(webHostActions.consent).toBeDefined();
  });
});

describe('a program/live trace host ask (EXEC-DIST-14)', () => {
  it('streams each item of the observed traits to the onMessage route until cancel-call names the key', async () => {
    const dispatched: Array<[string, string, unknown]> = [];
    const dispatch = async (trait: string, event: string, payload: unknown): Promise<void> => { dispatched.push([trait, event, payload]); };
    let emit: ((item: { type: string; dispatch: { seq: number } }) => void) | undefined;
    const watched: string[][] = [];
    let ended = 0;
    const source = (traits: readonly string[], onItem: (item: { type: string; dispatch: { seq: number } }) => void): (() => void) => {
      watched.push([...traits]);
      emit = onItem;
      return () => { ended += 1; emit = undefined; };
    };
    const completion = { trait: 'Watcher', key: 'watch', onMessage: 'MOVED', failure: 'WATCH_FAILED' };
    await answerHostAsk('program/live', [{ kind: 'trace', traits: ['Board'] }], completion, dispatch, source);
    expect(watched).toEqual([['Board']]);
    emit?.({ type: 'trace', dispatch: { seq: 0 } });
    emit?.({ type: 'trace', dispatch: { seq: 1 } });
    await answerHostAsk('cancel-call', ['watch'], undefined, dispatch, source);
    expect(ended).toBe(1);
    expect(emit).toBeUndefined();
    expect(dispatched).toEqual([
      ['Watcher', 'MOVED', { type: 'trace', dispatch: { seq: 0 }, key: 'watch' }],
      ['Watcher', 'MOVED', { type: 'trace', dispatch: { seq: 1 }, key: 'watch' }],
    ]);
  });

  it('refuses on the failure route a trace that names no traits or a key already streaming', async () => {
    const dispatched: Array<[string, string, unknown]> = [];
    const dispatch = async (trait: string, event: string, payload: unknown): Promise<void> => { dispatched.push([trait, event, payload]); };
    const source = (): (() => void) => () => undefined;
    const completion = { trait: 'Watcher', key: 'twice', onMessage: 'MOVED', failure: 'WATCH_FAILED' };
    await answerHostAsk('program/live', [{ kind: 'trace', traits: [] }], completion, dispatch, source);
    await answerHostAsk('program/live', [{ kind: 'trace', traits: ['Board'] }], completion, dispatch, source);
    await answerHostAsk('program/live', [{ kind: 'trace', traits: ['Board'] }], completion, dispatch, source);
    await answerHostAsk('cancel-call', ['twice'], undefined, dispatch, source);
    expect(dispatched).toEqual([
      ['Watcher', 'WATCH_FAILED', { error: 'program/live trace: name the traits it observes in `traits`', key: 'twice' }],
      ['Watcher', 'WATCH_FAILED', { error: 'key twice already has a stream open', key: 'twice' }],
    ]);
  });
});
