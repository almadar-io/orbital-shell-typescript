import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { installCredentialScopeStorage, installNetPort, type CredentialScopeStorage, type CredentialStore, type NetPort, type ResolvedHost } from '@almadar/shell-runtime';
import { pinnedFetchNode } from './pinned-fetch.js';

export { pinnedFetchNode };

export async function resolveHostNode(host: string): Promise<ResolvedHost> {
  if (isIP(host) !== 0) return { literal: true, addresses: [host] };
  const found = await lookup(host, { all: true });
  return { literal: false, addresses: found.map((entry) => entry.address) };
}

export const nodeNetPort: NetPort = { resolve: resolveHostNode, fetch: pinnedFetchNode };

export function nodeCredentialScope(): CredentialScopeStorage {
  return new AsyncLocalStorage<CredentialStore>();
}

let installed = false;

/** Install the Node ports `@almadar/shell-runtime` leaves open: the pinned `http` fetch + resolver and per-tenant credential scopes. Idempotent. */
export function installNodeHostPorts(): void {
  if (installed) return;
  installed = true;
  installNetPort(nodeNetPort);
  installCredentialScopeStorage(nodeCredentialScope());
}
