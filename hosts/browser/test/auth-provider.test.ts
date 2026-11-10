import { describe, expect, it } from 'vitest';
import { googleProvider } from '../src/auth/index.js';

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
