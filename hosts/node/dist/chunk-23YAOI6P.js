import { Agent, fetch } from 'undici';
import { AsyncLocalStorage } from 'async_hooks';
import { isIP } from 'net';
import { lookup } from 'dns/promises';
import { installNetPort, installCredentialScopeStorage } from '@almadar/shell-runtime';

// src/pinned-fetch.ts
var pinnedFetchNode = async (url, init, address) => {
  const dispatcher = new Agent({
    ...init.signal !== void 0 ? { headersTimeout: 0, bodyTimeout: 0 } : {},
    connect: {
      lookup: (_host, options, callback) => {
        const family = address.includes(":") ? 6 : 4;
        if (options.all === true) callback(null, [{ address, family }]);
        else callback(null, address, family);
      }
    }
  });
  try {
    return await fetch(url, { ...init, dispatcher });
  } finally {
    void dispatcher.close();
  }
};
async function resolveHostNode(host) {
  if (isIP(host) !== 0) return { literal: true, addresses: [host] };
  const found = await lookup(host, { all: true });
  return { literal: false, addresses: found.map((entry) => entry.address) };
}
var nodeNetPort = { resolve: resolveHostNode, fetch: pinnedFetchNode };
function nodeCredentialScope() {
  return new AsyncLocalStorage();
}
var installed = false;
function installNodeHostPorts() {
  if (installed) return;
  installed = true;
  installNetPort(nodeNetPort);
  installCredentialScopeStorage(nodeCredentialScope());
}

export { installNodeHostPorts, nodeCredentialScope, nodeNetPort, pinnedFetchNode, resolveHostNode };
