/**
 * The app's sign-in surface (`@almadar/auth/browser`) and the bearer headers every server call carries.
 *
 * Config comes from the served `/__/firebase/init.json` (Firebase Hosting's, or `orb serve`'s), else the
 * `VITE_APP_FIREBASE_*` vars of a Vite dev server. The local Auth emulator (dev) is that file's `authEmulatorHost`,
 * else `VITE_FIREBASE_AUTH_EMULATOR_HOST`; Firebase Hosting's own file never names one.
 * With no config at all the app runs signed-out: every request is anonymous.
 */
import { z } from 'zod';
import { connectAuth, type BrowserAuth } from '@almadar/auth/browser';

const FirebaseWebConfigSchema = z.object({
  apiKey: z.string().min(1),
  projectId: z.string().min(1),
  authDomain: z.string().optional(),
});

const HostedConfigSchema = FirebaseWebConfigSchema.extend({ authEmulatorHost: z.string().min(1).optional() });

let hostedConfig: Promise<z.infer<typeof HostedConfigSchema> | null> | null = null;

function servedConfig(): Promise<z.infer<typeof HostedConfigSchema> | null> {
  hostedConfig ??= fetch('/__/firebase/init.json')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((body) => {
      const parsed = HostedConfigSchema.safeParse(body);
      return parsed.success ? parsed.data : null;
    });
  return hostedConfig;
}

/** The local Auth emulator this page signs in on (dev only), or undefined. */
export async function authEmulatorHost(): Promise<string | undefined> {
  const served = await servedConfig();
  if (served !== null) return served.authEmulatorHost;
  const fromEnv: string | undefined = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
  return fromEnv;
}

async function webConfig(): Promise<z.infer<typeof FirebaseWebConfigSchema> | null> {
  const served = await servedConfig();
  if (served !== null) return { apiKey: served.apiKey, projectId: served.projectId, ...(served.authDomain !== undefined ? { authDomain: served.authDomain } : {}) };
  const fromEnv = FirebaseWebConfigSchema.safeParse({
    apiKey: import.meta.env.VITE_APP_FIREBASE_API_KEY,
    projectId: import.meta.env.VITE_APP_FIREBASE_PROJECT_ID,
    authDomain: import.meta.env.VITE_APP_FIREBASE_AUTH_DOMAIN,
  });
  return fromEnv.success ? fromEnv.data : null;
}

declare global {
  interface Window {
    /** Emulator dev only: lets a verifier sign this page in as a dev persona (a custom token from `/api/personas/sign-in`). */
    __almadarAuth?: { signInWithCustomToken(customToken: string): Promise<string>; currentUid(): Promise<string | null> };
  }
}

let connected: Promise<BrowserAuth | null> | null = null;

/** The app's one sign-in surface, or null when no Firebase config is present. */
export function connectAppAuth(): Promise<BrowserAuth | null> {
  connected ??= Promise.all([webConfig(), authEmulatorHost()]).then(([config, emulatorHost]) => {
    if (config === null) {
      console.warn('Firebase not configured — sign-in disabled (set VITE_APP_FIREBASE_* or serve /__/firebase/init.json)');
      return null;
    }
    return connectAuth({
      appName: 'app',
      ...config,
      ...(emulatorHost ? { emulatorHost } : {}),
    }).then((auth) => {
      if (emulatorHost) {
        window.__almadarAuth = {
          signInWithCustomToken: async (customToken) => (await auth.signInWithCustomToken(customToken)).uid,
          currentUid: () => auth.currentUid(),
        };
      }
      return auth;
    });
  });
  return connected;
}

/** JSON headers plus `Authorization: Bearer <ID token>` while someone is signed in. */
export async function authHeaders(): Promise<Record<string, string>> {
  const auth = await connectAppAuth();
  const token = auth ? await auth.idToken() : undefined;
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}
