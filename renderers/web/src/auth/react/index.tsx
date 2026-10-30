import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { z } from 'zod';
import { FieldValueSchema, type UserContext, type ViewerAuthority } from '@almadar/core';
import type { BrowserAuth, SignedInUser } from '@almadar/shell-browser/auth';
import { HostAskError, type HostAskFailureKind, type HostSignInAnswer, type HostSignInRequest } from '@almadar/shell-runtime/kernel/host';

export type { BrowserAuth, SignedInUser } from '@almadar/shell-browser/auth';

/** The provider's resolved viewer authority — `@almadar/core`'s {@link ViewerAuthority}. */
export type AuthAuthority = ViewerAuthority;

export interface AuthContextValue {
  /** The sign-in surface, or null when the app has no auth configured. */
  auth: BrowserAuth | null;
  user: SignedInUser | null;
  authority: AuthAuthority;
  /** An interactive auth action (or the initial connect) is in flight. */
  loading: boolean;
  /** The last interactive action's failure; a valid session survives it. */
  error: string | null;
  clearError(): void;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string, displayName?: string): Promise<void>;
  sendSignInLinkToEmail(email: string, returnUrl: string): Promise<void>;
  isSignInWithEmailLink(link: string): boolean;
  signInWithEmailLink(email: string, link: string): Promise<void>;
  signInWithCustomToken(customToken: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const NOT_CONFIGURED = 'Sign-in is not configured for this app';

export interface AuthProviderProps {
  /** Connects the app's sign-in surface; resolves null when the app has no auth configured. */
  connect: () => Promise<BrowserAuth | null>;
  children: ReactNode;
}

export function AuthProvider({ connect, children }: AuthProviderProps): ReactElement {
  const [auth, setAuth] = useState<BrowserAuth | null>(null);
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [authority, setAuthority] = useState<AuthAuthority>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    connect()
      .then((connected) => {
        if (cancelled) return;
        setAuth(connected);
        if (connected === null) {
          setAuthority('unavailable');
          setLoading(false);
          return;
        }
        unsubscribe = connected.onUserChanged(
          (next) => {
            setUser(next);
            setAuthority(next === null ? 'anonymous' : 'authenticated');
            setLoading(false);
          },
          (err) => {
            setUser(null);
            setAuthority('failed');
            setError(err.message);
            setLoading(false);
          },
        );
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setAuthority('failed');
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [connect]);

  const run = useCallback(async (action: (a: BrowserAuth) => Promise<SignedInUser | void>): Promise<void> => {
    if (auth === null) {
      setError(NOT_CONFIGURED);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await action(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  const value = useMemo<AuthContextValue>(() => ({
    auth,
    user,
    authority,
    loading,
    error,
    clearError: () => setError(null),
    signInWithGoogle: () => run((a) => a.signInWithGoogle()),
    signInWithEmail: (email, password) => run((a) => a.signInWithEmail(email, password)),
    signUpWithEmail: (email, password, displayName) => run((a) => a.signUpWithEmail(email, password, displayName)),
    sendSignInLinkToEmail: (email, returnUrl) => run((a) => a.sendSignInLinkToEmail(email, returnUrl)),
    isSignInWithEmailLink: (link) => auth?.isSignInWithEmailLink(link) ?? false,
    signInWithEmailLink: (email, link) => run((a) => a.signInWithEmailLink(email, link)),
    signInWithCustomToken: (customToken) => run((a) => a.signInWithCustomToken(customToken)),
    signOut: () => run((a) => a.signOut()),
  }), [auth, user, authority, loading, error, run]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The provider's value, or undefined outside an AuthProvider (an app with no sign-in surface). */
export function useOptionalAuth(): AuthContextValue | undefined {
  return useContext(AuthContext);
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return value;
}

const PersonasSchema = z.object({
  success: z.literal(true),
  personas: z.array(z.object({ id: z.string() }).catchall(FieldValueSchema)),
});
const SignInSchema = z.object({ success: z.literal(true), customToken: z.string() });

export interface DevPersonas {
  /** The app's `[identity]` rows; empty when the server offers no dev personas (no Auth emulator). */
  personas: UserContext[];
  signInAs(id: string): Promise<void>;
}

/**
 * The dev persona roster a program's `std-dev-personas` hooks offer (`personas`, `persona-sign-in`; they
 * answer only while the server runs on the Auth emulator), and sign-in as one of them: a real emulated
 * user, so `@user` resolves as in production.
 */
export function useDevPersonas(apiBase: string): DevPersonas {
  const { signInWithCustomToken } = useAuth();
  const [personas, setPersonas] = useState<UserContext[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBase}/api/hooks/personas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(async (res) => (res.ok ? PersonasSchema.parse(await res.json()).personas : []))
      .then((list) => {
        if (!cancelled) setPersonas(list);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const signInAs = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase}/api/hooks/persona-sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await signInWithCustomToken(SignInSchema.parse(await res.json()).customToken);
  }, [apiBase, signInWithCustomToken]);

  return { personas, signInAs };
}

const FIREBASE_FAILURE_KIND: Readonly<Record<string, HostAskFailureKind>> = {
  'auth/popup-closed-by-user': 'cancelled',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/user-cancelled': 'cancelled',
  'auth/wrong-password': 'denied',
  'auth/invalid-credential': 'denied',
  'auth/user-not-found': 'denied',
  'auth/user-disabled': 'denied',
  'auth/popup-blocked': 'denied',
  'auth/invalid-email': 'invalid',
  'auth/invalid-custom-token': 'invalid',
  'auth/invalid-action-code': 'invalid',
  'auth/expired-action-code': 'invalid',
  'auth/network-request-failed': 'unavailable',
  'auth/operation-not-allowed': 'unavailable',
};

function userAnswer(user: SignedInUser): HostSignInAnswer {
  return { uid: user.uid, ...(user.email !== undefined ? { email: user.email } : {}), ...(user.name !== undefined ? { displayName: user.name } : {}) };
}

/**
 * The host's `auth/sign-in` action over a connected Firebase auth: each method of the request is the one call the
 * auth surface offers for it. A provider failure keeps the kind its code names (`FIREBASE_FAILURE_KIND`); a code the
 * table does not list is `unavailable`.
 */
export function hostSignIn(auth: BrowserAuth): (request: HostSignInRequest) => Promise<HostSignInAnswer> {
  return async (request) => {
    try {
      if (request.method === 'google') return userAnswer(await auth.signInWithGoogle());
      if (request.method === 'email') return userAnswer(await auth.signInWithEmail(request.email, request.password));
      if (request.method === 'customToken') return userAnswer(await auth.signInWithCustomToken(request.token));
      if ('continueUrl' in request) {
        await auth.sendSignInLinkToEmail(request.email, request.continueUrl);
        return { sent: true };
      }
      return userAnswer(await auth.signInWithEmailLink(request.email, request.link));
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
      throw new HostAskError(code !== undefined ? (FIREBASE_FAILURE_KIND[code] ?? 'unavailable') : 'unavailable', error instanceof Error ? error.message : String(error));
    }
  };
}
