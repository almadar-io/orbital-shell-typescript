/**
 * The one TypeScript half of the `http` effect: the host side that moves the bytes the Rust request builder
 * (`@almadar/kernel`, wasm) produced. Both the kernel host (`host.ts`) and the interpreter (`EffectExecutor`)
 * call it; nothing here builds a request, frames a stream or shapes a payload — the wasm exports do.
 */
import { credentialStatusConnected, credentialStorageKey, resolveCredentialStatusIdentity, isJsonObject, type CredentialPayload, type JsonObject, type JsonValue, type RuntimeValue } from '@almadar/core';
import { getEffectiveCredentialStore, getModeControl, resolveCredentialRef } from '../credentials/scope.js';
import type { CredentialVault } from '../credentials/vault.js';
import { untilAborted } from '../effects/in-flight-calls.js';
import { decodeHttpRequest } from './decode.js';
import type { HttpBody, HttpFailureWire, HttpRequestWire, HttpResponseWire, IoRequestWire } from './wire.js';

/** The `@almadar/kernel` export the `http` port uses: the public-address check of a resolved host. */
export interface HttpKernel {
  isPublicAddress(ip: string): boolean;
}

/**
 * The host's secret store: a credential NAME in, its value out; `set` keeps a minted value (an OAuth2 token) for `ttlMs`.
 * `principal` is the signed-in user's id for a user-scoped credential (the kernel sets it from the dispatch's `@user`,
 * never the program); absent, the credential is app-wide.
 */
export interface HttpSecrets {
  get(name: string, principal?: string): Promise<string | undefined>;
  /** `ttlMs` of 0 forgets the value. */
  set(name: string, value: string, ttlMs: number, principal?: string): Promise<void>;
  /** Replace the stored credential with `value`, durably (a rotated refresh token). A host without one cannot rotate. */
  rotate?(name: string, value: string, principal?: string): Promise<void>;
  /** Drop the credential, the minted value and the stored one. */
  forget(name: string, principal?: string): Promise<void>;
  /** Keep `value` as the credential until it is forgotten, creating it when absent (an OAuth connection's tokens): unlike `rotate` it needs no existing entry. `label` is a non-secret account name stored beside it, never the value. */
  persist?(name: string, value: string, principal?: string, label?: string): Promise<void>;
  /** The non-secret account label stored beside the credential; absent when its row carries none. */
  label?(name: string, principal?: string): Promise<string | undefined>;
  /** Keep a one-use value (a pending OAuth grant) sealed in the credential store's rows, so it outlives the process and every instance on the same rows can take it; a host with no enabled store keeps it in memory. */
  hold?(name: string, value: string, ttlMs: number, principal?: string): Promise<void>;
  /** Remove and return a held value in one step, the single read of a one-use value; an expired one is consumed and not returned. */
  take?(name: string, principal?: string): Promise<string | undefined>;
  /** Whether `persist` keeps a value on this host. */
  durable?(): Promise<boolean>;
}

/** The credential-store key of one user's credential. */
export function userCredentialKey(principal: string, name: string): string {
  return credentialStorageKey({ name, principal });
}

/** Where a host name points: its addresses, and whether the name already is one. */
export interface ResolvedHost {
  literal: boolean;
  addresses: readonly string[];
}

export interface PinnedInit {
  method: string;
  headers: Array<[string, string]>;
  body?: Uint8Array<ArrayBuffer>;
  redirect: 'manual';
  signal?: AbortSignal;
}

/** The part of a fetch response the exchange reads. */
export interface PinnedResponse {
  status: number;
  headers: { entries(): IterableIterator<[string, string]> };
  body: { getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel?(): Promise<void>;
    releaseLock?(): void;
  } } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Fetch with the connection pinned to `address`, the one that was checked (no resolve-then-connect race). */
export type PinnedFetch = (url: URL, init: PinnedInit, address: string) => Promise<PinnedResponse>;

/** CSPRNG output: `bytes` random bytes. */
export type RandomSource = (bytes: number) => Uint8Array;

/**
 * The host's raw credential store and mode flag, answered to the kernel's `credentialStore*` and `credentialMode*`
 * asks. It decides nothing: the role gate, the declared-name check, the masking and the mode check are the kernel's.
 */
export interface CredentialAdminPort {
  /** Whether the store can encrypt and the service and name of every stored row; `null` when the host holds no store. */
  list(): Promise<{ enabled: boolean; entries: Array<{ service: string; name: string }> } | null>;
  /** The stored value of credential `name`, from the store only. */
  read(name: string): Promise<string | null>;
  write(service: string, name: string, value: string): Promise<void>;
  /** Whether a stored row existed. */
  remove(name: string): Promise<boolean>;
  rotate(): Promise<{ rotated: number; alreadyCurrent: number; unreadable: number }>;
  /** The mode flag; `null` when the host keeps none. */
  mode(): Promise<string | null>;
  /** Switch the flag; the host may refuse. The mode in force afterwards. */
  setMode(mode: string): Promise<string>;
}

export interface HttpPorts {
  kernel: () => Promise<HttpKernel>;
  /** The host CSPRNG `random-bytes` and the driver's `Random` ask draw from. */
  random: RandomSource;
  /** The program's declared `egress` origins. */
  egress: readonly string[];
  secrets: HttpSecrets;
  /** The credential store and mode flag the credential administration effects ask; absent, those asks fail unavailable. */
  credentials?: CredentialAdminPort;
  fetch: PinnedFetch;
  /** Looks a host up for the public-address check; `null` where the host cannot resolve a name (a browser). */
  resolve: ((host: string) => Promise<ResolvedHost>) | null;
}

export interface HttpPortsOptions {
  kernel: () => Promise<HttpKernel>;
  random?: RandomSource;
  egress: readonly string[];
  secrets?: HttpSecrets;
  /** Defaults to the installed credential store and mode flag. */
  credentials?: CredentialAdminPort;
  fetch?: PinnedFetch;
  resolve?: (host: string) => Promise<ResolvedHost>;
}

export interface BrowserHttpPortsOptions {
  kernel: () => Promise<HttpKernel>;
  /** The program's declared `egress` origins. */
  egress: readonly string[];
  /** Defaults to the global `fetch`. */
  fetch?: (url: string, init: RequestInit) => Promise<PinnedResponse & Response>;
}

/** The loud, coded error for a host that gave the `http` effect no ports. */
export class HttpUnavailableError extends Error {
  readonly code = 'HTTP_KERNEL_UNAVAILABLE';
  constructor(detail: string) {
    super(`HTTP_KERNEL_UNAVAILABLE: ${detail}`);
  }
}

/** A failed `http` effect: its payload is what the `emit.failure` route carries. */
/** Where the secrets' durable credentials live: the store a host installed, and how a name resolves through it. */
export interface HttpSecretsHost {
  store(): Promise<CredentialVault | null>;
  resolve(name: string, principal: string | undefined): Promise<string | undefined>;
}

/** The credential store the host installed, with its environment fallback. */
const installedSecretsHost: HttpSecretsHost = {
  async store() {
    return getEffectiveCredentialStore();
  },
  async resolve(name, principal) {
    return resolveCredentialRef(name, undefined, principal);
  },
};

/**
 * The secrets of a host: minted values with an expiry (a memory tier that never reaches the rows), then the credential vault
 * the host holds (by default the one the host installed). Everything durable is the kernel's: `rotate`, `persist`, `label`,
 * `forget`, and a one-use value held sealed in the rows (`hold`, `take`). A host with no enabled vault holds a one-use value
 * in memory, as the native host does.
 */
export function createHttpSecrets(now: () => number = Date.now, host: HttpSecretsHost = installedSecretsHost): HttpSecrets {
  type Minted = Map<string, { value: string; expiresAt: number }>;
  const environmentMinted: Minted = new Map();
  const storeMinted = new WeakMap<CredentialVault, Minted>();
  const cacheFor = (store: CredentialVault | null): Minted => {
    if (store === null) return environmentMinted;
    const held = storeMinted.get(store);
    if (held !== undefined) return held;
    const cache: Minted = new Map();
    storeMinted.set(store, cache);
    return cache;
  };
  const slot = (name: string, principal: string | undefined): string => credentialStorageKey({ name, ...(principal !== undefined ? { principal } : {}) });
  const takeMinted = (minted: Minted, key: string): string | undefined => {
    const held = minted.get(key);
    if (held === undefined) return undefined;
    minted.delete(key);
    return held.expiresAt > now() ? held.value : undefined;
  };
  return {
    async get(name, principal) {
      const minted = cacheFor(await host.store());
      const key = slot(name, principal);
      const held = minted.get(key);
      if (held !== undefined) {
        if (held.expiresAt > now()) return held.value;
        minted.delete(key);
      }
      return host.resolve(name, principal);
    },
    async set(name, value, ttlMs, principal) {
      const minted = cacheFor(await host.store());
      const key = slot(name, principal);
      if (ttlMs <= 0) minted.delete(key);
      else minted.set(key, { value, expiresAt: now() + ttlMs });
    },
    async rotate(name, value, principal) {
      const store = await host.store();
      if (store === null) throw new Error('this host keeps no credential store to rotate into');
      cacheFor(store).delete(slot(name, principal));
      await store.replace(name, value, principal);
    },
    async persist(name, value, principal, label) {
      const store = await host.store();
      if (store === null || !store.enabled) throw new Error('this host keeps no credential store to persist into');
      cacheFor(store).delete(slot(name, principal));
      await store.persist(name, value, principal, label);
    },
    async hold(name, value, ttlMs, principal) {
      const store = await host.store();
      const minted = cacheFor(store);
      const key = slot(name, principal);
      if (store !== null && store.enabled) {
        minted.delete(key);
        if (ttlMs > 0) await store.hold(name, value, now() + ttlMs, now(), principal);
        else await store.take(name, now(), principal);
        return;
      }
      if (ttlMs <= 0) minted.delete(key);
      else minted.set(key, { value, expiresAt: now() + ttlMs });
    },
    async take(name, principal) {
      const store = await host.store();
      if (store !== null && store.enabled) {
        const shared = await store.take(name, now(), principal);
        if (shared !== undefined) return shared;
      }
      return takeMinted(cacheFor(store), slot(name, principal));
    },
    async label(name, principal) {
      return (await host.store())?.label(name, principal);
    },
    async durable() {
      const store = await host.store();
      return store !== null && store.enabled;
    },
    async forget(name, principal) {
      const store = await host.store();
      const minted = cacheFor(store);
      const key = slot(name, principal);
      minted.delete(key);
      await store?.remove(name, principal);
    },
  };
}

/** The credential store and mode flag the host installed, as the kernel's raw asks. */
export function createCredentialAdminPort(): CredentialAdminPort {
  const installed = (): CredentialVault => {
    const store = getEffectiveCredentialStore();
    if (store === null) throw new Error('this host keeps no credential store');
    return store;
  };
  return {
    async list() {
      return getEffectiveCredentialStore()?.listing() ?? null;
    },
    async read(name) {
      return getEffectiveCredentialStore()?.resolve(name) ?? null;
    },
    async write(service, name, value) {
      await installed().set(service, name, value);
    },
    async remove(name) {
      return installed().remove(name);
    },
    async rotate() {
      return installed().rotate();
    },
    async mode() {
      return getModeControl()?.mode ?? null;
    },
    async setMode(mode) {
      const control = getModeControl();
      if (control === null) throw new Error('No integration manager is installed on this host');
      if (mode !== 'mock' && mode !== 'real') throw new Error(`mode must be "mock" or "real", got "${mode}"`);
      control.setMode(mode);
      return control.mode;
    },
  };
}

/** Bytes from the platform CSPRNG. */
export const systemRandom: RandomSource = (bytes) => crypto.getRandomValues(new Uint8Array(bytes));

/** The most bytes one `random-bytes` may ask for (the kernel's `RANDOM_BYTES_MAX`). */
export const RANDOM_BYTES_MAX = 1024;

function binary(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** Standard padded base64 (the wire form of a `Random` answer). */
export function base64Standard(bytes: Uint8Array): string {
  return btoa(binary(bytes));
}

/** URL-safe base64 without padding (the `random-bytes` value; the kernel's `codec::base64url_encode`). */
export function base64Url(bytes: Uint8Array): string {
  return base64Standard(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * `random-bytes`: the success payload for `bytes` drawn from the host CSPRNG; a bad count or key is the effect's
 * failure. A keyed call echoes its `key` beside the `value`.
 */
export function randomBytesPayload(ports: Pick<HttpPorts, 'random'>, bytes: RuntimeValue | undefined, key?: RuntimeValue): { value: string; key?: string } {
  if (key !== undefined && (typeof key !== 'string' || key === '')) {
    throw new Error(`call key must evaluate to a non-empty string, got ${String(key)}`);
  }
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > RANDOM_BYTES_MAX) {
    throw new Error(`random-bytes: the byte count must be an integer from 1 to ${RANDOM_BYTES_MAX}, got ${String(bytes)}`);
  }
  const value = base64Url(ports.random(bytes));
  return key === undefined ? { value } : { value, key };
}

function signedIn(head: string, principal: string | undefined): string {
  if (principal === undefined) throw new Error(`${head}: nobody is signed in`);
  return principal;
}

function credentialName(head: string, credential: RuntimeValue | undefined): string {
  if (typeof credential !== 'string') throw new Error(`${head}: the credential must be a secret knob's name`);
  return credential;
}

/** `credential-status`: a bare name selects the viewer; an explicit slot selects its declared scope. */
export async function credentialStatusPayload(
  ports: Pick<HttpPorts, 'secrets'>,
  credential: RuntimeValue | undefined,
  principal: string | undefined,
): Promise<CredentialPayload> {
  const identity = resolveCredentialStatusIdentity(credential, principal);
  const connected = credentialStatusConnected(await ports.secrets.get(identity.name, identity.principal), identity.principal);
  const label = connected ? ((await ports.secrets.label?.(identity.name, identity.principal)) ?? '') : '';
  return { connected, label };
}

/** `credential-forget`: drops the signed-in viewer's credential; `{ connected: false }`. */
export async function credentialForgetPayload(
  ports: Pick<HttpPorts, 'secrets'>,
  credential: RuntimeValue | undefined,
  principal: string | undefined,
): Promise<{ connected: false; label: string }> {
  const who = signedIn('credential-forget', principal);
  const name = credentialName('credential-forget', credential);
  await ports.secrets.forget(name, who);
  return { connected: false, label: '' };
}

/** The Node half of the server `http` ports: name resolution and the address-pinned fetch (`@almadar/shell-node` installs it). */
export interface NetPort {
  resolve: (host: string) => Promise<ResolvedHost>;
  fetch: PinnedFetch;
}

let installedNet: NetPort | null = null;

export function installNetPort(port: NetPort): void {
  installedNet = port;
}

function netPort(): NetPort {
  if (installedNet === null) throw new Error('createHttpPorts needs a NetPort for its default fetch/resolve: install one (@almadar/shell-node installNodeHostPorts) or pass both');
  return installedNet;
}

export function createHttpPorts(options: HttpPortsOptions): HttpPorts {
  return {
    kernel: options.kernel,
    random: options.random ?? systemRandom,
    egress: options.egress,
    secrets: options.secrets ?? createHttpSecrets(),
    credentials: options.credentials ?? createCredentialAdminPort(),
    fetch: options.fetch ?? netPort().fetch,
    resolve: options.resolve ?? netPort().resolve,
  };
}

/** A browser holds no credential: a keyless call never asks for one, and a keyed call must not reach a browser. */
const browserSecrets: HttpSecrets = {
  async get(name) {
    throw new Error(`credential ${name} is not available in a browser`);
  },
  async set(name) {
    throw new Error(`credential ${name} cannot be stored in a browser`);
  },
  async forget(name) {
    throw new Error(`credential ${name} cannot be forgotten in a browser`);
  },
};

/**
 * Ports for a client-site `http` (a call with no `auth`): the same kernel driver and exchange as the server,
 * over the browser's `fetch`. A browser cannot resolve a name or pin a connection, so there is no
 * public-address check; the program's `egress` (the driver refuses any other origin) and the browser's own
 * CORS rules bound what the call reaches.
 */
export function createBrowserHttpPorts(options: BrowserHttpPortsOptions): HttpPorts {
  const browserFetch = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    kernel: options.kernel,
    random: systemRandom,
    egress: options.egress,
    secrets: browserSecrets,
    fetch: (url, init) => browserFetch(url.href, { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}), redirect: init.redirect, ...(init.signal !== undefined ? { signal: init.signal } : {}) }),
    resolve: null,
  };
}

/** What one exchange came to; a cancelled exchange is the caller's abort signal, never an outcome. */
export type Exchange =
  | { kind: 'reply'; response: HttpResponseWire }
  | { kind: 'failure'; failure: HttpFailureWire };

function parsed(json: string): JsonValue {
  return JSON.parse(json);
}

function record(value: JsonValue, what: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${what} is not an object`);
  return value;
}

function bodyBytes(body: HttpBody): Uint8Array<ArrayBuffer> | undefined {
  switch (body.kind) {
    case 'empty':
      return undefined;
    case 'text':
      return new TextEncoder().encode(body.text);
    case 'base64':
      return Uint8Array.from(atob(body.data), (char) => char.charCodeAt(0));
  }
}

function wireBody(bytes: Uint8Array): HttpBody {
  if (bytes.length === 0) return { kind: 'empty' };
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { kind: 'base64', data: btoa(binary) };
  }
}

function refusal(message: string): Exchange {
  return { kind: 'failure', failure: { kind: 'refused', message } };
}

/** The address a request may be sent to (the one every check passed), or the refusal. */
async function checkedAddress(ports: HttpPorts, kernel: HttpKernel, url: URL): Promise<{ address: string } | { refused: string }> {
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (ports.resolve === null) return { address: host };
  const resolved = await ports.resolve(host);
  const [first] = resolved.addresses;
  if (first === undefined) return { refused: `${host} resolves to no address` };
  if (resolved.literal && ports.egress.includes(url.origin)) return { address: first };
  const closed = resolved.addresses.find((address) => !kernel.isPublicAddress(address));
  if (closed !== undefined) return { refused: `${host} resolves to ${closed}, which is not a public address` };
  return { address: first };
}

/**
 * Send one built request. `signal` is the caller's cancel: when it aborts, this rejects (the keyed-call
 * registry reads that as a cancel). A timeout or a transport error is an outcome, not a throw.
 */
async function dispatch(
  ports: HttpPorts,
  request: HttpRequestWire,
  signal: AbortSignal | undefined,
  read: (response: PinnedResponse, signal: AbortSignal | undefined) => Promise<Exchange>,
): Promise<Exchange> {
  const kernel = await ports.kernel();
  signal?.throwIfAborted();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return refusal(`${request.url} is not a URL`);
  }
  const timeout = request.timeoutMs !== undefined ? AbortSignal.timeout(request.timeoutMs) : undefined;
  const signals = [signal, timeout].filter((s): s is AbortSignal => s !== undefined);
  const operationSignal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
  const body = bodyBytes(request.body);
  try {
    const lookup = checkedAddress(ports, kernel, url);
    const checked = operationSignal !== undefined ? await untilAborted(operationSignal, lookup) : await lookup;
    operationSignal?.throwIfAborted();
    if ('refused' in checked) return refusal(checked.refused);
    const response = await ports.fetch(url, {
      method: request.method,
      headers: request.headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      ...(operationSignal !== undefined ? { signal: operationSignal } : {}),
    }, checked.address);
    operationSignal?.throwIfAborted();
    return await read(response, operationSignal);
  } catch (error) {
    if (signal?.aborted === true) throw error;
    if (timeout?.aborted === true) return { kind: 'failure', failure: { kind: 'timedOut' } };
    return { kind: 'failure', failure: { kind: 'failed', message: error instanceof Error ? error.message : String(error) } };
  }
}

function headerPairs(response: PinnedResponse): Array<[string, string]> {
  return Array.from(response.headers.entries());
}

async function waitForHttpDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (!Number.isFinite(delayMs) || !Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('http delayMs must be a nonnegative whole number');
  }
  signal?.throwIfAborted();
  let remaining = delayMs;
  while (remaining > 0) {
    signal?.throwIfAborted();
    const duration = Math.min(remaining, 2_147_483_647);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, duration);
      function onAbort(): void {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason ?? new Error('The call was cancelled'));
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    remaining -= duration;
  }
}

/** Send one built request after its requested retry delay and read the whole reply. */
export async function sendHttp(ports: HttpPorts, request: HttpRequestWire, signal?: AbortSignal, delayMs = 0): Promise<Exchange> {
  await waitForHttpDelay(delayMs, signal);
  return dispatch(ports, request, signal, async (response) => ({
    kind: 'reply',
    response: { status: response.status, headers: headerPairs(response), body: wireBody(new Uint8Array(await response.arrayBuffer())) },
  }));
}
