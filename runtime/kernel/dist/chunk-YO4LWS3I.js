import { untilAborted } from './chunk-MZKIL5IN.js';
import { deliverBeacon } from './chunk-VMOBW7RK.js';
import { decodeHttpRequest, decodeOAuthAsk } from './chunk-RBUMDYFS.js';
import { resolveCredentialRef, getEffectiveCredentialStore, getModeControl } from './chunk-HLOUDLPI.js';
import { credentialStorageKey, resolveCredentialStatusIdentity, credentialStatusConnected, isJsonObject } from '@almadar/core';

function userCredentialKey(principal, name) {
  return credentialStorageKey({ name, principal });
}
var HttpUnavailableError = class extends Error {
  code = "HTTP_KERNEL_UNAVAILABLE";
  constructor(detail) {
    super(`HTTP_KERNEL_UNAVAILABLE: ${detail}`);
  }
};
var HttpEffectFailure = class extends Error {
  constructor(payload) {
    super(payload.error);
    this.payload = payload;
  }
  payload;
};
var PERSISTED_SERVICE = "kernel";
var installedSecretsHost = {
  async store() {
    return getEffectiveCredentialStore();
  },
  async resolve(name, principal) {
    return resolveCredentialRef(name, void 0, principal);
  }
};
function createHttpSecrets(now = Date.now, host = installedSecretsHost) {
  const environmentMinted = /* @__PURE__ */ new Map();
  const storeMinted = /* @__PURE__ */ new WeakMap();
  const cacheFor = (store) => {
    if (store === null) return environmentMinted;
    const held = storeMinted.get(store);
    if (held !== void 0) return held;
    const cache = /* @__PURE__ */ new Map();
    storeMinted.set(store, cache);
    return cache;
  };
  const slot = (name, principal) => credentialStorageKey({ name, ...principal !== void 0 ? { principal } : {} });
  return {
    async get(name, principal) {
      const minted = cacheFor(await host.store());
      const key = slot(name, principal);
      const held = minted.get(key);
      if (held !== void 0) {
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
      if (store === null) throw new Error("this host keeps no credential store to rotate into");
      const stored = store.entries(principal).find((entry) => entry.envVar === name);
      if (stored === void 0) throw new Error(`credential ${name} is not in the credential store`);
      cacheFor(store).delete(slot(name, principal));
      await store.set(stored.service, name, value, principal);
    },
    async persist(name, value, principal, label) {
      const store = await host.store();
      if (store === null || !store.enabled) throw new Error("this host keeps no credential store to persist into");
      cacheFor(store).delete(slot(name, principal));
      await store.set(PERSISTED_SERVICE, name, value, principal, label);
    },
    async hold(name, value, ttlMs, principal) {
      const store = await host.store();
      const minted = cacheFor(store);
      const key = slot(name, principal);
      if (store !== null && store.sharesDerived) {
        minted.delete(key);
        if (ttlMs > 0) await store.holdDerived(name, value, now() + ttlMs, principal);
        return;
      }
      if (ttlMs <= 0) minted.delete(key);
      else minted.set(key, { value, expiresAt: now() + ttlMs });
    },
    async take(name, principal) {
      const store = await host.store();
      if (store !== null && store.sharesDerived) {
        const shared = await store.takeDerived(name, principal, now());
        if (shared !== void 0) return shared;
      }
      const minted = cacheFor(store);
      const key = slot(name, principal);
      const held = minted.get(key);
      if (held === void 0) return void 0;
      minted.delete(key);
      return held.expiresAt > now() ? held.value : void 0;
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
    }
  };
}
function createCredentialAdminPort() {
  return {
    async list() {
      const store = getEffectiveCredentialStore();
      if (store === null) return null;
      return { enabled: store.enabled, entries: store.entries().map((entry) => ({ service: entry.service, name: entry.envVar })) };
    },
    async read(name) {
      return getEffectiveCredentialStore()?.resolve(name) ?? null;
    },
    async write(service, name, value) {
      const store = getEffectiveCredentialStore();
      if (store === null) throw new Error("this host keeps no credential store");
      await store.set(service, name, value);
    },
    async remove(name) {
      const store = getEffectiveCredentialStore();
      if (store === null) throw new Error("this host keeps no credential store");
      return store.remove(name);
    },
    async rotate() {
      const store = getEffectiveCredentialStore();
      if (store === null) throw new Error("this host keeps no credential store");
      return store.rotate();
    },
    async mode() {
      return getModeControl()?.mode ?? null;
    },
    async setMode(mode) {
      const control = getModeControl();
      if (control === null) throw new Error("No integration manager is installed on this host");
      if (mode !== "mock" && mode !== "real") throw new Error(`mode must be "mock" or "real", got "${mode}"`);
      control.setMode(mode);
      return control.mode;
    }
  };
}
var systemRandom = (bytes) => crypto.getRandomValues(new Uint8Array(bytes));
var RANDOM_BYTES_MAX = 1024;
function binary(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}
function base64Standard(bytes) {
  return btoa(binary(bytes));
}
function base64Url(bytes) {
  return base64Standard(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function randomBytesPayload(ports, bytes, key) {
  if (key !== void 0 && (typeof key !== "string" || key === "")) {
    throw new Error(`call key must evaluate to a non-empty string, got ${String(key)}`);
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 || bytes > RANDOM_BYTES_MAX) {
    throw new Error(`random-bytes: the byte count must be an integer from 1 to ${RANDOM_BYTES_MAX}, got ${String(bytes)}`);
  }
  const value = base64Url(ports.random(bytes));
  return key === void 0 ? { value } : { value, key };
}
function signedIn(head, principal) {
  if (principal === void 0) throw new Error(`${head}: nobody is signed in`);
  return principal;
}
function credentialName(head, credential) {
  if (typeof credential !== "string") throw new Error(`${head}: the credential must be a secret knob's name`);
  return credential;
}
async function credentialStatusPayload(ports, credential, principal) {
  const identity = resolveCredentialStatusIdentity(credential, principal);
  const connected = credentialStatusConnected(await ports.secrets.get(identity.name, identity.principal), identity.principal);
  const label = connected ? await ports.secrets.label?.(identity.name, identity.principal) ?? "" : "";
  return { connected, label };
}
async function credentialForgetPayload(ports, credential, principal) {
  const who = signedIn("credential-forget", principal);
  const name = credentialName("credential-forget", credential);
  await ports.secrets.forget(name, who);
  return { connected: false, label: "" };
}
var installedNet = null;
function installNetPort(port) {
  installedNet = port;
}
function netPort() {
  if (installedNet === null) throw new Error("createHttpPorts needs a NetPort for its default fetch/resolve: install one (@almadar/shell-node installNodeHostPorts) or pass both");
  return installedNet;
}
function createHttpPorts(options) {
  return {
    kernel: options.kernel,
    random: options.random ?? systemRandom,
    egress: options.egress,
    secrets: options.secrets ?? createHttpSecrets(),
    credentials: options.credentials ?? createCredentialAdminPort(),
    fetch: options.fetch ?? netPort().fetch,
    resolve: options.resolve ?? netPort().resolve,
    ...options.oauth !== void 0 ? { oauth: options.oauth } : {}
  };
}
var browserSecrets = {
  async get(name) {
    throw new Error(`credential ${name} is not available in a browser`);
  },
  async set(name) {
    throw new Error(`credential ${name} cannot be stored in a browser`);
  },
  async forget(name) {
    throw new Error(`credential ${name} cannot be forgotten in a browser`);
  }
};
function createBrowserHttpPorts(options) {
  const browserFetch = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    kernel: options.kernel,
    random: systemRandom,
    egress: options.egress,
    secrets: browserSecrets,
    fetch: (url, init) => browserFetch(url.href, { method: init.method, headers: init.headers, ...init.body !== void 0 ? { body: init.body } : {}, redirect: init.redirect, ...init.signal !== void 0 ? { signal: init.signal } : {} }),
    resolve: null,
    beacon: options.beacon ?? browserBeaconPorts()
  };
}
function browserBeaconPorts() {
  const hasQueue = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function";
  return {
    ...hasQueue ? { queue: (url, text) => navigator.sendBeacon(url, new Blob([text], { type: "text/plain" })) } : {},
    fetch: async (url, init) => ({ status: (await fetch(url, init)).status })
  };
}
function parsed(json) {
  return JSON.parse(json);
}
function record(value, what) {
  if (!isJsonObject(value)) throw new Error(`${what} is not an object`);
  return value;
}
function bodyBytes(body) {
  switch (body.kind) {
    case "empty":
      return void 0;
    case "text":
      return new TextEncoder().encode(body.text);
    case "base64":
      return Uint8Array.from(atob(body.data), (char) => char.charCodeAt(0));
  }
}
function wireBody(bytes) {
  if (bytes.length === 0) return { kind: "empty" };
  try {
    return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    let binary2 = "";
    for (const byte of bytes) binary2 += String.fromCharCode(byte);
    return { kind: "base64", data: btoa(binary2) };
  }
}
function refusal(message) {
  return { kind: "failure", failure: { kind: "refused", message } };
}
async function checkedAddress(ports, kernel, url) {
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (ports.resolve === null) return { address: host };
  const resolved = await ports.resolve(host);
  const [first] = resolved.addresses;
  if (first === void 0) return { refused: `${host} resolves to no address` };
  if (resolved.literal && ports.egress.includes(url.origin)) return { address: first };
  const closed = resolved.addresses.find((address) => !kernel.isPublicAddress(address));
  if (closed !== void 0) return { refused: `${host} resolves to ${closed}, which is not a public address` };
  return { address: first };
}
async function dispatch(ports, request, signal, read) {
  const kernel = await ports.kernel();
  signal?.throwIfAborted();
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return refusal(`${request.url} is not a URL`);
  }
  const timeout = request.timeoutMs !== void 0 ? AbortSignal.timeout(request.timeoutMs) : void 0;
  const signals = [signal, timeout].filter((s) => s !== void 0);
  const operationSignal = signals.length > 0 ? AbortSignal.any(signals) : void 0;
  const body = bodyBytes(request.body);
  try {
    const lookup = checkedAddress(ports, kernel, url);
    const checked = operationSignal !== void 0 ? await untilAborted(operationSignal, lookup) : await lookup;
    operationSignal?.throwIfAborted();
    if ("refused" in checked) return refusal(checked.refused);
    const response = await ports.fetch(url, {
      method: request.method,
      headers: request.headers,
      ...body !== void 0 ? { body } : {},
      redirect: "manual",
      ...operationSignal !== void 0 ? { signal: operationSignal } : {}
    }, checked.address);
    operationSignal?.throwIfAborted();
    return await read(response, operationSignal);
  } catch (error) {
    if (signal?.aborted === true) throw error;
    if (timeout?.aborted === true) return { kind: "failure", failure: { kind: "timedOut" } };
    return { kind: "failure", failure: { kind: "failed", message: error instanceof Error ? error.message : String(error) } };
  }
}
function headerPairs(response) {
  return Array.from(response.headers.entries());
}
async function waitForHttpDelay(delayMs, signal) {
  if (!Number.isFinite(delayMs) || !Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error("http delayMs must be a nonnegative whole number");
  }
  signal?.throwIfAborted();
  let remaining = delayMs;
  while (remaining > 0) {
    signal?.throwIfAborted();
    const duration = Math.min(remaining, 2147483647);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, duration);
      function onAbort() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(signal?.reason ?? new Error("The call was cancelled"));
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    remaining -= duration;
  }
}
async function sendHttp(ports, request, signal, delayMs = 0) {
  await waitForHttpDelay(delayMs, signal);
  return dispatch(ports, request, signal, async (response) => ({
    kind: "reply",
    response: { status: response.status, headers: headerPairs(response), body: wireBody(new Uint8Array(await response.arrayBuffer())) }
  }));
}
function streamEvent(value) {
  const event = record(value, "a stream event");
  const { data, event: name, id, key } = event;
  if (typeof data !== "string" || name !== null && typeof name !== "string" || id !== null && typeof id !== "string" || key !== null && typeof key !== "string") {
    throw new Error("a stream event is malformed");
  }
  return { data, event: name, id, key };
}
function streamHttp(ports, request, stream, onEvent, signal) {
  return dispatch(ports, request, signal, async (response, readSignal) => {
    const kernel = await ports.kernel();
    readSignal?.throwIfAborted();
    const decoder = new TextDecoder();
    let carry = "";
    const publish = (chunk) => {
      readSignal?.throwIfAborted();
      const framed = record(parsed(kernel.frameStream(stream.framing, stream.key, chunk, carry)), "frameStream result");
      const { events, carry: rest } = framed;
      if (!Array.isArray(events) || typeof rest !== "string") throw new Error("frameStream result is malformed");
      carry = rest;
      for (const event of events) {
        readSignal?.throwIfAborted();
        onEvent(streamEvent(event));
      }
    };
    const reader = response.body?.getReader();
    let completed = false;
    try {
      if (reader !== void 0) {
        for (; ; ) {
          const pending = reader.read();
          const next = readSignal !== void 0 ? await untilAborted(readSignal, pending) : await pending;
          readSignal?.throwIfAborted();
          if (next.done) break;
          publish(decoder.decode(next.value, { stream: true }));
        }
      }
      const tail = decoder.decode();
      if (tail !== "") publish(tail);
      readSignal?.throwIfAborted();
      const flushed = parsed(kernel.frameStreamFinish(stream.framing, stream.key, carry));
      if (!Array.isArray(flushed)) throw new Error("frameStreamFinish result is malformed");
      for (const event of flushed) {
        readSignal?.throwIfAborted();
        onEvent(streamEvent(event));
      }
      readSignal?.throwIfAborted();
      completed = true;
      return { kind: "reply", response: { status: response.status, headers: headerPairs(response), body: { kind: "empty" } } };
    } finally {
      if (!completed) {
        void Promise.resolve().then(() => reader?.cancel?.()).catch(() => void 0);
      }
      void Promise.resolve().then(() => reader?.releaseLock?.()).catch(() => void 0);
    }
  });
}
var BEACON_UNAVAILABLE = "browser/beacon: this host has no beacon port";
async function sendBeaconRequest(ports, request, signal) {
  if (ports.beacon === void 0) return { ok: { via: "unavailable", message: BEACON_UNAVAILABLE } };
  if (request.body.kind !== "text") throw new Error("a beacon request carries a text body");
  signal?.throwIfAborted();
  const delivery = deliverBeacon(request.url, request.body.text, ports.beacon).then((taken) => taken.via === "fetch" && taken.status === null ? { error: { kind: "failed", message: "the beacon fetch failed" } } : { ok: taken.via === "queue" ? { via: "queue" } : { via: "fetch", status: taken.status ?? 0 } });
  return signal !== void 0 ? untilAborted(signal, delivery) : delivery;
}
function isOAuthCode(value) {
  return value === "AUTH_ERROR" || value === "VALIDATION_ERROR" || value === "NOT_CONFIGURED" || value === "SERVICE_ERROR" || value === "NETWORK_ERROR";
}
function isOAuthReason(value) {
  switch (value) {
    case "state-unknown":
    case "state-expired":
    case "subject-mismatch":
    case "provider-mismatch":
    case "not-signed-in":
    case "store-unavailable":
    case "metadata-invalid":
    case "response-invalid":
    case "token-rejected":
    case "userinfo-mismatch":
    case "unconfigured-client":
      return true;
    default:
      return false;
  }
}
function unavailableFailure(error, key) {
  return { error, kind: "unavailable", key, credential: null, phase: null, grantStatus: null, grantBody: null, code: null, reason: null };
}
function decodeFailurePayload(value) {
  const payload = record(value, "a failure payload");
  const { error, kind, key, credential, phase, grantStatus, grantBody, code, reason } = payload;
  const malformed = () => {
    throw new Error("a failure payload is malformed");
  };
  if (typeof error !== "string" || key !== null && typeof key !== "string") return malformed();
  if (phase !== null && phase !== "grant" && phase !== "request") return malformed();
  if (grantStatus !== null && typeof grantStatus !== "number") return malformed();
  if (grantBody !== null && typeof grantBody !== "string") return malformed();
  if (kind === "oauth") {
    if (credential !== null || phase !== null || grantStatus !== null || grantBody !== null) return malformed();
    if (!isOAuthCode(code) || !isOAuthReason(reason)) return malformed();
    return { ...payload, error, kind, key, credential, phase, grantStatus, grantBody, code, reason };
  }
  if (code !== null || reason !== null) return malformed();
  if (kind === "unconfigured" && typeof credential === "string") {
    return { ...payload, error, kind, key, credential, phase, grantStatus, grantBody, code, reason };
  }
  if ((kind === "timeout" || kind === "failed" || kind === "refused" || kind === "unavailable") && credential === null) {
    return { ...payload, error, kind, key, credential, phase, grantStatus, grantBody, code, reason };
  }
  return malformed();
}
function failureAnswer(failure) {
  switch (failure.kind) {
    case "timedOut":
      return { kind: "timedOut" };
    case "failed":
    case "refused":
      return { kind: failure.kind, message: failure.message };
  }
}
function exchangeAnswer(exchange) {
  return { kind: "http", result: exchange.kind === "reply" ? { ok: { ...exchange.response } } : { error: failureAnswer(exchange.failure) } };
}
function settledAnswer(kind, outcome) {
  return { kind, result: outcome };
}
function checkOAuthReply(reply) {
  switch (reply.reply) {
    case "done":
    case "flag":
    case "taken":
    case "row":
    case "subject":
    case "metadata":
    case "millis":
    case "mockToken":
    case "code":
      return reply;
  }
}
var OAUTH_UNAVAILABLE = "this host keeps no OAuth state";
async function oauthAnswer(ports, ask, principal) {
  if (ports.oauth === void 0) return { kind: "oauth", result: { error: OAUTH_UNAVAILABLE } };
  try {
    return { kind: "oauth", result: { ok: checkOAuthReply(await ports.oauth.answer(ask, principal)) } };
  } catch (error) {
    return { kind: "oauth", result: { error: error instanceof Error ? error.message : String(error) } };
  }
}
function askOwner(ask, principal) {
  if (ask.scope === void 0 || ask.scope === "app") return { owner: void 0 };
  if (ask.scope !== "user") throw new Error(`driver ask "${String(ask.kind)}" has an unknown scope`);
  return principal === void 0 ? { error: "nobody is signed in" } : { owner: principal };
}
async function answerAsk(ports, ask, key, options) {
  const { kind } = ask;
  switch (kind) {
    case "secret": {
      if (typeof ask.name !== "string") throw new Error('driver ask "secret" has no name');
      const who = askOwner(ask, options.principal);
      if ("error" in who) return settledAnswer("secret", who);
      try {
        return settledAnswer("secret", { ok: await ports.secrets.get(ask.name, who.owner) ?? null });
      } catch (error) {
        return settledAnswer("secret", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    case "secretSet": {
      if (typeof ask.name !== "string" || typeof ask.value !== "string" || typeof ask.ttlMs !== "number") throw new Error('driver ask "secretSet" is malformed');
      const who = askOwner(ask, options.principal);
      if ("error" in who) return settledAnswer("secretSet", who);
      try {
        await ports.secrets.set(ask.name, ask.value, ask.ttlMs, who.owner);
        return settledAnswer("secretSet", { ok: null });
      } catch (error) {
        return settledAnswer("secretSet", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    case "secretRotate": {
      if (typeof ask.name !== "string" || typeof ask.value !== "string") throw new Error('driver ask "secretRotate" is malformed');
      const who = askOwner(ask, options.principal);
      if ("error" in who) return settledAnswer("secretRotate", who);
      try {
        if (ports.secrets.rotate === void 0) throw new Error("this host keeps no rotatable credentials");
        await ports.secrets.rotate(ask.name, ask.value, who.owner);
        return settledAnswer("secretRotate", { ok: null });
      } catch (error) {
        return settledAnswer("secretRotate", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    case "oauth":
      return oauthAnswer(ports, decodeOAuthAsk(ask.ask), options.principal);
    case "random": {
      if (typeof ask.bytes !== "number" || !Number.isInteger(ask.bytes) || ask.bytes < 0) throw new Error('driver ask "random" is malformed');
      try {
        return settledAnswer("random", { ok: base64Standard(ports.random(ask.bytes)) });
      } catch (error) {
        return settledAnswer("random", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    case "http": {
      const delayMs = ask.delayMs;
      if (delayMs !== void 0 && typeof delayMs !== "number") throw new Error('driver ask "http" has a malformed delayMs');
      return exchangeAnswer(await sendHttp(ports, decodeHttpRequest(askRequest(ask)), options.signal, delayMs));
    }
    case "beacon": {
      return { kind: "beacon", result: await sendBeaconRequest(ports, decodeHttpRequest(askRequest(ask)), options.signal) };
    }
    case "httpStream": {
      const framing = ask.framing;
      if (framing !== "sse" && framing !== "jsonLines") throw new Error('driver ask "httpStream" has an unknown framing');
      const onEvent = options.onMessage ?? (() => void 0);
      return exchangeAnswer(await streamHttp(ports, decodeHttpRequest(askRequest(ask)), { framing, key }, onEvent, options.signal));
    }
    default:
      throw new Error(`driver asked for unknown "${String(kind)}"`);
  }
}
function askRequest(ask) {
  const request = ask.request;
  if (request === void 0) throw new Error(`driver ask "${String(ask.kind)}" has no request`);
  return request;
}
async function runHttpCall(ports, call, options = {}) {
  if (call.delivery === "beacon" && ports.beacon === void 0) return { error: unavailableFailure(BEACON_UNAVAILABLE, call.key ?? null) };
  const kernel = await ports.kernel();
  const key = call.key ?? null;
  const started = options.principal !== void 0 ? { ...call, principal: options.principal } : call;
  let progress = record(parsed(kernel.httpDriverStart(JSON.stringify(started), JSON.stringify(ports.egress))), "httpDriverStart result");
  for (; ; ) {
    const step = record(progress.step ?? null, "the driver step");
    if (step.kind === "done") {
      const result = record(step.result ?? null, "the driver result");
      if (result.ok !== void 0) return { ok: result.ok };
      if (result.error !== void 0) return { error: decodeFailurePayload(result.error) };
      throw new Error("the driver finished with neither ok nor error");
    }
    if (step.kind !== "ask") throw new Error(`the driver step "${String(step.kind)}" is unknown`);
    const driver = JSON.stringify(progress.driver ?? null);
    try {
      const answer = await answerAsk(ports, record(step.ask ?? null, "the driver ask"), key, options);
      progress = record(parsed(kernel.httpDriverResume(driver, JSON.stringify(answer))), "httpDriverResume result");
    } catch (error) {
      kernel.httpDriverDrop(driver);
      throw error;
    }
  }
}

export { HttpEffectFailure, HttpUnavailableError, RANDOM_BYTES_MAX, base64Standard, base64Url, checkOAuthReply, createBrowserHttpPorts, createCredentialAdminPort, createHttpPorts, createHttpSecrets, credentialForgetPayload, credentialStatusPayload, installNetPort, isOAuthCode, isOAuthReason, randomBytesPayload, runHttpCall, sendBeaconRequest, sendHttp, streamHttp, systemRandom, unavailableFailure, userCredentialKey };
