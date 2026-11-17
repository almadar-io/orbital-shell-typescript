import { describe, expect, it } from 'vitest';
import { googleProvider, idTokenOf } from '../src/auth/index.js';

describe('googleProvider', () => {
  it('a credential sign-in asks Google for the account picker', () => {
    expect(googleProvider('credential').getCustomParameters()).toEqual({ prompt: 'select_account' });
  });

  it('control: the page viewer sign-in keeps Google default account choice', () => {
    expect(googleProvider('viewer').getCustomParameters()).toEqual({});
  });

  it('edge: each call gives a fresh provider, so a credential sign-in never leaks the picker into a viewer one', () => {
    googleProvider('credential');
    expect(googleProvider('viewer').getCustomParameters()).toEqual({});
  });
});

describe('idTokenOf — the bearer a request carries', () => {
  // A fake of the two members the token read uses: the saved session is restored only once authStateReady resolves.
  const restoring = (token: string | null) => {
    let ready = (): void => undefined;
    const state = { currentUser: null as { getIdToken: () => Promise<string> } | null };
    const settled = new Promise<void>((resolve) => { ready = resolve; });
    const auth = {
      get currentUser() { return state.currentUser; },
      authStateReady: async () => { await settled; },
    };
    return { auth, restore: () => { if (token !== null) state.currentUser = { getIdToken: async () => token }; ready(); } };
  };

  it('waits for the saved session before answering, so a first request carries the remembered viewer', async () => {
    const { auth, restore } = restoring('tok-1');
    const asked = idTokenOf(auth);
    restore();
    expect(await asked).toBe('tok-1');
  });

  it('control: with no saved session it answers no token once the state is known', async () => {
    const { auth, restore } = restoring(null);
    const asked = idTokenOf(auth);
    restore();
    expect(await asked).toBeUndefined();
  });
});
