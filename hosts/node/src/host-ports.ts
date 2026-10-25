import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { CredentialVault, CREDENTIAL_MASTER_KEY_ENV, CREDENTIAL_PREVIOUS_MASTER_KEY_ENV, installCredentialScopeStorage, installCredentialStore, installNetPort, type CredentialScopeStorage, type CredentialVaultModule, type NetPort, type ResolvedHost } from '@almadar/shell-runtime';
import { credentialsFilePath, fileCredentialRows } from './credential-rows.js';
import { pinnedFetchNode } from './pinned-fetch.js';

export { pinnedFetchNode };

export async function resolveHostNode(host: string): Promise<ResolvedHost> {
  if (isIP(host) !== 0) return { literal: true, addresses: [host] };
  const found = await lookup(host, { all: true });
  return { literal: false, addresses: found.map((entry) => entry.address) };
}

export const nodeNetPort: NetPort = { resolve: resolveHostNode, fetch: pinnedFetchNode };

export function nodeCredentialScope(): CredentialScopeStorage {
  return new AsyncLocalStorage<CredentialVault>();
}

let installed = false;

/** Install the Node ports `@almadar/shell-runtime` leaves open: the pinned `http` fetch + resolver and per-tenant credential scopes. Idempotent. */
export function installNodeHostPorts(): void {
  if (installed) return;
  installed = true;
  installNetPort(nodeNetPort);
  installCredentialScopeStorage(nodeCredentialScope());
}

export interface NodeCredentialVaultOptions {
  /** The kernel module that carries the vault class (`@almadar/kernel`, initialised). */
  kernel: CredentialVaultModule;
  /** Defaults to the process env, which the native host reads the same keys and file from. */
  env?: Record<string, string | undefined>;
  /** Defaults to the working directory, where the native host looks for `.almadar/dev-credentials.json`. */
  cwd?: string;
}

/**
 * The durable credential vault of a Node host, as the native host opens it: the key in `ALMADAR_CREDENTIAL_MASTER_KEY`
 * (and `..._PREVIOUS` in a rotation window), the rows in the encrypted file `ALMADAR_CREDENTIALS_FILE` names, else
 * `.almadar/dev-credentials.json`, so one file serves both hosts. With no master key set the host has no store and this
 * answers `null`; a key that is not 64 hex digits, or a row the kernel cannot read, rejects. The vault is installed as the
 * process-wide credential store.
 */
export async function installNodeCredentialVault(options: NodeCredentialVaultOptions): Promise<CredentialVault | null> {
  const env = options.env ?? process.env;
  const master = env[CREDENTIAL_MASTER_KEY_ENV];
  if (master === undefined) return null;
  const previous = env[CREDENTIAL_PREVIOUS_MASTER_KEY_ENV];
  const vault = await CredentialVault.open(
    new options.kernel.CredentialVault(master, previous === undefined || previous === '' ? undefined : previous),
    fileCredentialRows(credentialsFilePath(env, options.cwd)),
  );
  installCredentialStore(vault);
  return vault;
}
