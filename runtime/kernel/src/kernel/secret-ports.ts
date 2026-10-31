/**
 * The host ports of the kernel's secret, random and credential asks: the secret store, the CSPRNG and the credential
 * administration port. The `http` effect is retired (HTTP/1.1 is `.lolo` over `os/*`), so nothing here moves HTTP bytes.
 */
import { credentialStatusConnected, credentialStorageKey, resolveCredentialStatusIdentity, type CredentialPayload, type RuntimeValue } from '@almadar/core';
import { getEffectiveCredentialStore, getModeControl, resolveCredentialRef } from '../credentials/scope.js';
import type { CredentialVault, TokenEndpointPost } from '../credentials/vault.js';
import type { ConnectFailure, CredentialGrantWire, CredentialStanding } from '@almadar/core/kernel-wire';

/**
 * The host's secret store: a credential NAME in, its value out; `set` keeps a minted value for `ttlMs`.
 * `principal` is the signed-in user's id for a user-scoped credential (the kernel sets it from the dispatch's `@user`,
 * never the program); absent, the credential is app-wide.
 */
export interface SecretStore {
  get(name: string, principal?: string): Promise<string | undefined>;
  /** `ttlMs` of 0 forgets the value. */
  set(name: string, value: string, ttlMs: number, principal?: string): Promise<void>;
  /** Replace the stored credential with `value`, durably (a rotated refresh token). A host without one cannot rotate. */
  rotate?(name: string, value: string, principal?: string): Promise<void>;
  /** Drop the credential, the minted value and the stored one. */
  forget(name: string, principal?: string): Promise<void>;
  /** Keep `value` as the credential until it is forgotten, creating it when absent: unlike `rotate` it needs no existing entry. `label` is a non-secret account name stored beside it, never the value. */
  persist?(name: string, value: string, principal?: string, label?: string): Promise<void>;
  /** The non-secret account label stored beside the credential; absent when its row carries none. */
  label?(name: string, principal?: string): Promise<string | undefined>;
  /** Whether `persist` keeps a value on this host. */
  durable?(): Promise<boolean>;
}

/** The credential-store key of one user's credential. */
export function userCredentialKey(principal: string, name: string): string {
  return credentialStorageKey({ name, principal });
}

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

/** The tails of the named variables this host's own environment holds: `last4` only from eight characters up, never a value. */
export type EnvTailsPort = (names: readonly string[]) => Array<{ name: string; last4?: string }>;

/** The environment tails of `env`: a name it holds non-empty, with the last four characters of a value of eight or more. */
export function envTailsOf(env: Readonly<Record<string, string | undefined>>): EnvTailsPort {
  return (names) => {
    const tails: Array<{ name: string; last4?: string }> = [];
    for (const name of names) {
      const value = env[name];
      if (value === undefined || value === '') continue;
      const chars = Array.from(value);
      tails.push(chars.length >= 8 ? { name, last4: chars.slice(-4).join('') } : { name });
    }
    return tails;
  };
}

/** The host's answer to a `credentialConnect` ask: the kernel's store builds the exchange and settles it, the host only sends it. */
export type CredentialConnectPort = (grant: CredentialGrantWire) => Promise<{ ok: CredentialStanding } | { error: ConnectFailure }>;

export interface SecretPorts {
  /** The host CSPRNG `random-bytes` and the driver's `Random` ask draw from. */
  random: RandomSource;
  secrets: SecretStore;
  /** The credential store and mode flag the credential administration effects ask; absent, those asks fail unavailable. */
  credentials?: CredentialAdminPort;
  /** The host's own environment, for `credential-list`; absent, the host answers `unsupported` (a browser reads none). */
  env?: EnvTailsPort;
  /** Carries a `credentialConnect`; absent, the ask answers `unavailable`. */
  connect?: CredentialConnectPort;
}

export interface SecretPortsOptions {
  random?: RandomSource;
  secrets?: SecretStore;
  /** Defaults to the installed credential store and mode flag. */
  credentials?: CredentialAdminPort;
  /** Defaults to the process environment. */
  env?: EnvTailsPort;
  /** The host's POST to a token endpoint; with it the credential store connects and refreshes OAuth credentials, without it neither is attempted. */
  tokenPost?: TokenEndpointPost;
}

/** Where the secrets' durable credentials live: the store a host installed, and how a name resolves through it. */
export interface SecretStoreHost {
  store(): Promise<CredentialVault | null>;
  resolve(name: string, principal: string | undefined): Promise<string | undefined>;
}

/** The credential store the host installed, with its environment fallback. */
const installedSecretsHost: SecretStoreHost = {
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
 * and `forget`.
 */
export function createSecretStore(now: () => number = Date.now, host: SecretStoreHost = installedSecretsHost, tokenPost?: TokenEndpointPost): SecretStore {
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
  return {
    async get(name, principal) {
      const store = await host.store();
      const minted = cacheFor(store);
      const key = slot(name, principal);
      const held = minted.get(key);
      if (held !== undefined) {
        if (held.expiresAt > now()) return held.value;
        minted.delete(key);
      }
      if (store !== null && store.enabled && tokenPost !== undefined) {
        const fresh = await store.resolveFresh(name, principal, tokenPost);
        if (fresh !== undefined) return fresh;
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

/** `credentialConnect` over the installed credential store and the host's token POST. */
export function createCredentialConnectPort(post: TokenEndpointPost): CredentialConnectPort {
  return async (grant) => {
    const store = getEffectiveCredentialStore();
    if (store === null || !store.enabled) return { error: { kind: 'unavailable', message: 'this host holds no credential store that can connect' } };
    return store.connect(grant, post);
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
export function randomBytesPayload(ports: Pick<SecretPorts, 'random'>, bytes: RuntimeValue | undefined, key?: RuntimeValue): { value: string; key?: string } {
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
  ports: Pick<SecretPorts, 'secrets'>,
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
  ports: Pick<SecretPorts, 'secrets'>,
  credential: RuntimeValue | undefined,
  principal: string | undefined,
): Promise<{ connected: false; label: string }> {
  const who = signedIn('credential-forget', principal);
  const name = credentialName('credential-forget', credential);
  await ports.secrets.forget(name, who);
  return { connected: false, label: '' };
}

export function createSecretPorts(options: SecretPortsOptions = {}): SecretPorts {
  return {
    random: options.random ?? systemRandom,
    secrets: options.secrets ?? createSecretStore(Date.now, installedSecretsHost, options.tokenPost),
    credentials: options.credentials ?? createCredentialAdminPort(),
    env: options.env ?? ((names) => envTailsOf(process.env)(names)),
    ...(options.tokenPost !== undefined ? { connect: createCredentialConnectPort(options.tokenPost) } : {}),
  };
}

/** A browser holds no credential: a secret ask must not reach a browser. */
const browserSecrets: SecretStore = {
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

/** Ports of a browser: it holds no credential, so a secret ask fails and the CSPRNG is the page's. */
export function createBrowserSecretPorts(): SecretPorts {
  return { random: systemRandom, secrets: browserSecrets };
}
