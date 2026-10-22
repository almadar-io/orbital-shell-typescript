import { BrowserHttpPortsOptions, CredentialStore, HttpPorts, CredentialPersistence } from '@almadar/shell-web';
import { C as ChromeTabsApi, a as ChromeRuntimeApi } from './content-C8fwCyhb.js';
export { P as PageCommandError, b as PageExecutor, c as PageMessage, d as PageReply, T as TabElement, e as createPageExecutor, r as runPageContentScript } from './content-C8fwCyhb.js';
import { TabUrlMatcher, BrowserTabPort, OnDeviceModelPort, OnDeviceEmbedderPort } from '@almadar/core';
export { OnDeviceEmbedderPort } from '@almadar/core';
import '@almadar/core/kernel-wire';

/**
 * The `http` ports of a browser-extension host that holds credentials: the browser's own `fetch` for the bytes, and the
 * profile's credential store (the server host's encrypted rows, kept in `chrome.storage`) for every secret the kernel
 * asks. A program names a credential and the kernel resolves it here; no value is ever answered to the program.
 */

/** A credential the host keeps because a sign-in succeeded: the value stays with the host, `label` is the non-secret account name. */
interface SignedInCredential {
    name: string;
    value: string;
    label: string;
}
interface ExtensionHttpPortsOptions extends BrowserHttpPortsOptions {
    /** The warmed credential store of this browser profile. */
    credentials: Promise<CredentialStore>;
    /** Credentials the build supplies (an OAuth client id), read when the store holds none and only for the app-wide credential. */
    provisioned?: Readonly<Record<string, string>>;
    /**
     * The host's own sign-in, run when a real `oauth-authorize` asks for the person's consent: the host signs them in natively
     * (no code exchange, no client secret) and answers the credential to keep, or `null` when they did not sign in. The
     * credential is stored app-wide beside its label; the consent answer is always no code, so the program learns the outcome
     * only through `credential-status`.
     */
    signIn?: () => Promise<SignedInCredential | null>;
}
declare function createExtensionHttpPorts(options: ExtensionHttpPortsOptions): HttpPorts;

/**
 * The browser-tab port over Chrome: the worker side (tabs, messages to and from content scripts) and the
 * content-script side (one executor over the page). Each takes the slice of the Chrome API it uses as a parameter,
 * so the extension passes `chrome.*` and tests pass fakes. Neither side decides anything: the kernel validates the
 * requests and shapes the results, this performs one raw tab or page operation per ask.
 */

/** The worker side: tabs and messages to and from the content scripts, performing the kernel's raw asks. */
declare function chromeTabPort(tabs: ChromeTabsApi, runtime: ChromeRuntimeApi, matches: TabUrlMatcher): BrowserTabPort;

/** The slice of `chrome.storage` a browser host keeps its rows in. */
interface ChromeStorageArea {
    get(key: string): Promise<Record<string, object>>;
    set(items: Record<string, object>): Promise<void>;
    remove(key: string): Promise<void>;
}
declare const CHROME_CREDENTIAL_ROWS_KEY = "almadar.credentials.rows";
declare const CHROME_CREDENTIAL_MASTER_KEY = "almadar.credentials.masterKey";
/** The store's rows kept as one array under one `chrome.storage` key; writes are applied one after another. */
declare function chromeCredentialRows(storage: ChromeStorageArea): CredentialPersistence;
/**
 * The warmed credential store of this browser profile. Its master key is minted on first use and kept in the same
 * extension storage, so the rows stay in the server host's format while the browser's own storage isolation is what protects them.
 */
declare function createChromeCredentialStore(storage: ChromeStorageArea): Promise<CredentialStore>;

type ChromePortErrorCode = 'CANCELLED' | 'TIMEOUT_ERROR' | 'MODEL_UNAVAILABLE' | 'AUTH_ERROR';
/** A raw Chrome port that could not answer; `code` says why, `details` carries the numbers a message names. */
declare class ChromePortError extends Error {
    readonly code: ChromePortErrorCode;
    readonly details: Record<string, number>;
    constructor(message: string, code: ChromePortErrorCode, details?: Record<string, number>);
}

/** A Prompt API session. */
interface ChromeModelSession {
    prompt(text: string, options: {
        responseConstraint: object;
        signal?: AbortSignal;
    }): Promise<string>;
    clone(): Promise<ChromeModelSession>;
    destroy(): void;
}
/** Chrome's built-in Prompt API (`LanguageModel`). */
interface ChromeLanguageModel {
    availability(): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
    create(): Promise<ChromeModelSession>;
}
/** How long one prompt may run. Chrome's model service occasionally never answers a prompt; without a deadline that stalls every call queued behind it. */
declare const PROMPT_TIMEOUT_MS = 30000;
interface ChromePromptModelOptions {
    timeoutMs?: number;
}
/**
 * Chrome's Prompt API behind the on-device model port, looked up at each call (the model can arrive
 * after start); an absent API reads as unavailable.
 */
declare function chromePromptModel(lookup: () => ChromeLanguageModel | undefined, options?: ChromePromptModelOptions): OnDeviceModelPort;

/**
 * The on-device text embedder behind `browser/embed`. The host injects the library (the
 * chrome-extension shell passes transformers.js), so the browser entry stays dependency-free.
 */

/** A feature-extraction pipeline, as transformers.js returns it. */
type FeatureExtractor = (texts: string[], options: {
    pooling: 'mean';
    normalize: true;
}) => Promise<{
    tolist(): number[][];
}>;
interface TransformersEmbedderOptions {
    /** Prepended to every text (e5 models expect `query: `). */
    prefix?: string;
}
/** An embedder over a feature-extraction pipeline, loaded on first use; a failed load is retried on the next call. */
declare function transformersEmbedder(load: () => Promise<FeatureExtractor>, options?: TransformersEmbedderOptions): OnDeviceEmbedderPort;

/** The slice of `chrome.identity` a sign-in uses. */
interface ChromeIdentityApi {
    getRedirectURL(): string;
    launchWebAuthFlow(details: {
        url: string;
        interactive: boolean;
    }): Promise<string | undefined>;
}
/** A credential the host keeps because a sign-in succeeded: `label` is the non-secret account name. */
interface KeptCredential {
    name: string;
    value: string;
    label: string;
}
interface GoogleSignInOptions {
    /** Web API key of the Firebase project. */
    apiKey: string;
    /** The Google OAuth web client id allowed for the extension's redirect URL. */
    clientId: string;
    /** The credential name the Firebase refresh token is kept under. */
    credential: string;
    identity: ChromeIdentityApi;
    fetch: typeof fetch;
    now?: () => number;
}
/**
 * Signs the person in with Google (secret-less implicit flow in Chrome's web-auth window) and exchanges the Google
 * `id_token` for a Firebase session. A closed window or a callback without an `id_token` is no sign-in (`null`); a rejected
 * exchange throws. The kernel's own authorization URL is not used: this host's consent is Chrome's, not a code exchange.
 */
declare function googleSignIn(options: GoogleSignInOptions): () => Promise<KeptCredential | null>;
/**
 * The host's `fetch` for a Firebase project: a request to Firebase's token or identity endpoint that carries no `key` gets the
 * project's web API key as its `key` query parameter, so a program names only the bare endpoint and the key never appears in
 * a program. Any other request, and a request that already names a key, is sent as it is.
 */
declare function firebaseKeyedFetch(apiKey: string, send: typeof fetch): typeof fetch;

export { CHROME_CREDENTIAL_MASTER_KEY, CHROME_CREDENTIAL_ROWS_KEY, type ChromeIdentityApi, type ChromeLanguageModel, type ChromeModelSession, ChromePortError, type ChromePortErrorCode, type ChromePromptModelOptions, ChromeRuntimeApi, type ChromeStorageArea, ChromeTabsApi, type ExtensionHttpPortsOptions, type FeatureExtractor, type GoogleSignInOptions, type KeptCredential, PROMPT_TIMEOUT_MS, type SignedInCredential, type TransformersEmbedderOptions, chromeCredentialRows, chromePromptModel, chromeTabPort, createChromeCredentialStore, createExtensionHttpPorts, firebaseKeyedFetch, googleSignIn, transformersEmbedder };
