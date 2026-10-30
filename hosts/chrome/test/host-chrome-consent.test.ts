/** The Chrome `auth/consent` answer over a fake chrome.identity. */
import { describe, it, expect } from 'vitest';
import { hostAskReturn, performHostAnswer } from '@almadar/shell-runtime/kernel/host';
import { chromeConsent, type ChromeIdentityApi } from '../src/host/index.js';

const AUTHORIZE = 'https://idp.example/authorize?state=s1';
const completion = { trait: 'Consent', key: 'k1', success: 'CONSENT_GRANTED', failure: 'CONSENT_FAILED' };

function identity(answer: () => Promise<string | undefined>, seen: Array<{ url: string; interactive: boolean }> = []): () => ChromeIdentityApi {
  return () => ({ launchWebAuthFlow: async (details) => { seen.push(details); return answer(); } });
}

describe('chromeConsent', () => {
  it('launches the authorize URL interactively and returns the code and state of the redirect as the ask outcome', async () => {
    const seen: Array<{ url: string; interactive: boolean }> = [];
    const consent = chromeConsent(identity(async () => 'https://abc.chromiumapp.org/cb?code=c1&state=s1&extra=x', seen));
    const outcome = await performHostAnswer({ consent }, 'auth/consent', [{ authorizeUrl: AUTHORIZE }]);
    expect(seen).toEqual([{ url: AUTHORIZE, interactive: true }]);
    expect(outcome).toEqual({ ok: { code: 'c1', state: 's1' } });
    expect(hostAskReturn(completion, outcome)).toEqual({ trait: 'Consent', event: 'CONSENT_GRANTED', payload: { code: 'c1', state: 's1', key: 'k1' } });
  });

  it('a refused flow, a redirect without code and state, and a missing chrome.identity each fail by name on the failure route', async () => {
    const refused = await performHostAnswer({ consent: chromeConsent(identity(async () => { throw new Error('The user did not approve access.'); })) }, 'auth/consent', [{ authorizeUrl: AUTHORIZE }]);
    expect(refused).toEqual({ error: 'The user did not approve access.', kind: 'denied' });
    expect(hostAskReturn(completion, refused)).toEqual({ trait: 'Consent', event: 'CONSENT_FAILED', payload: { error: 'The user did not approve access.', kind: 'denied', key: 'k1' } });
    const bare = await performHostAnswer({ consent: chromeConsent(identity(async () => 'https://abc.chromiumapp.org/cb?error=access_denied')) }, 'auth/consent', [{ authorizeUrl: AUTHORIZE }]);
    expect(bare).toMatchObject({ kind: 'denied' });
    const none = await performHostAnswer({ consent: chromeConsent(identity(async () => undefined)) }, 'auth/consent', [{ authorizeUrl: AUTHORIZE }]);
    expect(none).toMatchObject({ kind: 'denied' });
    const absent = await performHostAnswer({ consent: chromeConsent(() => undefined) }, 'auth/consent', [{ authorizeUrl: AUTHORIZE }]);
    expect(absent).toMatchObject({ kind: 'unavailable' });
  });
});
