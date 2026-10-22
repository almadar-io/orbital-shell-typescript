/** Build-time configuration of the Firebase project the extension signs in against (VITE_ env at build). Absent, the host supplies no provisioned id, sign-in or keyed fetch. */
import { firebaseKeyedFetch, googleSignIn } from '@almadar/shell-chrome';
import type { ExtensionHttpPortsOptions } from '@almadar/shell-chrome';

export interface KnowledgeConfig {
  baseUrl: string;
  apiKey: string;
  googleClientId: string;
}

const env = import.meta.env;

export const knowledgeConfig: KnowledgeConfig | null =
  env.VITE_KNOWLEDGE_BASE_URL && env.VITE_KNOWLEDGE_FIREBASE_API_KEY && env.VITE_KNOWLEDGE_GOOGLE_CLIENT_ID
    ? { baseUrl: env.VITE_KNOWLEDGE_BASE_URL, apiKey: env.VITE_KNOWLEDGE_FIREBASE_API_KEY, googleClientId: env.VITE_KNOWLEDGE_GOOGLE_CLIENT_ID }
    : null;

/**
 * What the extension host supplies to a program that names credentials: the OAuth client id the build provisions (the
 * program names it as a `secret` knob, the kernel resolves it here), and the host's own Google sign-in for a real
 * `oauth-authorize`: Chrome's web-auth window with Google's secret-less implicit flow, then the Firebase session, whose refresh
 * token is kept as the credential `KNOWLEDGE_REFRESH_TOKEN` with the account's email as its label. The program receives neither.
 * No client secret exists anywhere in this extension.
 */
export interface ExtensionHostConfig {
  provisioned: Record<string, string>;
  signIn: ExtensionHttpPortsOptions['signIn'];
  /** The host's `fetch`: Firebase token and identity requests carry the project's web API key (`VITE_KNOWLEDGE_FIREBASE_API_KEY`), so no program names it. */
  fetch: typeof fetch;
}

const plainFetch: typeof fetch = (input, init) => fetch(input, init);

export const extensionHost: ExtensionHostConfig = {
  fetch: knowledgeConfig ? firebaseKeyedFetch(knowledgeConfig.apiKey, plainFetch) : plainFetch,
  provisioned: knowledgeConfig ? { KNOWLEDGE_GOOGLE_CLIENT_ID: knowledgeConfig.googleClientId } : {},
  signIn: knowledgeConfig
    ? () =>
        googleSignIn({
          apiKey: knowledgeConfig.apiKey,
          clientId: knowledgeConfig.googleClientId,
          credential: 'KNOWLEDGE_REFRESH_TOKEN',
          identity: chrome.identity,
          fetch: plainFetch,
        })()
    : undefined,
};
