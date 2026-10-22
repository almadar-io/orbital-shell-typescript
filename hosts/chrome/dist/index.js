export { PageCommandError, createPageExecutor, runPageContentScript } from './chunk-NDZK2ITE.js';
import { createHttpSecrets, createOAuthPort, createBrowserHttpPorts, CREDENTIAL_ENTITY_TYPE, CredentialStore } from '@almadar/shell-web';
import { TabHostFailure, EntityRowSchema } from '@almadar/core';

function createExtensionHttpPorts(options) {
  const provisioned = new Map(Object.entries(options.provisioned ?? {}));
  const secrets = createHttpSecrets(Date.now, {
    store: () => options.credentials,
    async resolve(name, principal) {
      const held = (await options.credentials).resolve(name, principal);
      return held ?? (principal === void 0 ? provisioned.get(name) : void 0);
    }
  });
  const signIn = options.signIn;
  return {
    ...createBrowserHttpPorts(options),
    secrets,
    oauth: createOAuthPort({
      secrets,
      ...signIn !== void 0 ? {
        consent: async () => {
          const kept = await signIn();
          if (kept !== null) await secrets.persist?.(kept.name, kept.value, void 0, kept.label === "" ? void 0 : kept.label);
          return null;
        }
      } : {}
    })
  };
}
function chromeTabPort(tabs, runtime, matches) {
  const watches = /* @__PURE__ */ new Map();
  const readyWaiters = /* @__PURE__ */ new Map();
  async function send(tab, command) {
    const reply = await tabs.sendMessage(tab, { almadarPage: "command", command }).catch(() => void 0);
    if (reply === void 0) throw new TabHostFailure("not-ready", `Tab ${tab} has no page script`);
    if ("error" in reply) throw new TabHostFailure(reply.error.kind, reply.error.message);
    return reply.result;
  }
  async function attach(tab, watchId, watch) {
    try {
      await send(tab, { kind: "watch", watchId, selector: watch.selector, fields: watch.fields });
    } catch (error) {
      if (!(error instanceof TabHostFailure) || error.kind !== "not-ready") throw error;
    }
  }
  runtime.onMessage.addListener((message, sender) => {
    const tab = sender.tab?.id;
    if (tab === void 0) return;
    if (message.almadarPage === "ready") {
      const waiting = readyWaiters.get(tab) ?? [];
      readyWaiters.delete(tab);
      for (const wake of waiting) wake();
      for (const [watchId, watch] of watches) {
        if (matches(watch.match, message.url)) void attach(tab, watchId, watch).catch(() => void 0);
      }
    } else if (message.almadarPage === "element") {
      watches.get(message.watchId)?.deliver({ tab, elementId: message.element.elementId, url: message.url, fields: message.element.fields });
    }
  });
  async function awaitReady(tab, timeoutMs, signal) {
    const started = Date.now();
    const ready = await new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        readyWaiters.set(tab, (readyWaiters.get(tab) ?? []).filter((w) => w !== waiter));
        resolve(false);
      }, timeoutMs);
      readyWaiters.set(tab, [...readyWaiters.get(tab) ?? [], waiter]);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        readyWaiters.set(tab, (readyWaiters.get(tab) ?? []).filter((w) => w !== waiter));
        resolve(false);
      });
    });
    return { ready, waitedMs: Date.now() - started };
  }
  return {
    async perform(ask, context) {
      switch (ask.kind) {
        case "list":
          return (await tabs.query({})).flatMap(
            (t) => t.id === void 0 ? [] : [{ tab: t.id, url: t.url ?? "", title: t.title ?? "", active: t.active === true }]
          );
        case "open": {
          const opened = await tabs.create({ url: ask.url, active: ask.active });
          if (opened.id === void 0) throw new TabHostFailure("failed", `Chrome did not open ${ask.url}`);
          return opened.id;
        }
        case "close":
          await tabs.remove(ask.tab);
          return null;
        case "navigate":
          await tabs.update(ask.tab, { url: ask.url });
          return null;
        case "command":
          return send(ask.tab, ask.command);
        case "capture": {
          const windowId = (await tabs.update(ask.tab, { active: true }))?.windowId;
          if (windowId === void 0) throw new TabHostFailure("failed", `Chrome did not say which window shows tab ${ask.tab}`);
          return tabs.captureVisibleTab(windowId, { format: ask.format, ...typeof ask.quality === "number" ? { quality: ask.quality } : {} }).catch((error) => {
            throw new TabHostFailure("not-ready", `Tab ${ask.tab} cannot be captured: ${error.message}`);
          });
        }
        case "awaitReady":
          return awaitReady(ask.tab, ask.timeoutMs, context.signal);
        case "watch": {
          const known = watches.has(ask.watchId);
          const watch = { match: ask.match, selector: ask.selector, fields: ask.fields, deliver: context.deliver };
          watches.set(ask.watchId, watch);
          if (known) return null;
          for (const t of await tabs.query({})) {
            if (t.id !== void 0 && matches(watch.match, t.url ?? "")) await attach(t.id, ask.watchId, watch);
          }
          return null;
        }
        case "unwatch": {
          const stopped = watches.delete(ask.watchId);
          if (stopped) {
            for (const t of await tabs.query({})) {
              if (t.id !== void 0) await send(t.id, { kind: "unwatch", watchId: ask.watchId }).catch(() => void 0);
            }
          }
          return stopped;
        }
      }
    }
  };
}
var CHROME_CREDENTIAL_ROWS_KEY = "almadar.credentials.rows";
var CHROME_CREDENTIAL_MASTER_KEY = "almadar.credentials.masterKey";
function chromeCredentialRows(storage) {
  let queue = Promise.resolve();
  const read = async () => {
    const held = (await storage.get(CHROME_CREDENTIAL_ROWS_KEY))[CHROME_CREDENTIAL_ROWS_KEY];
    const rows = EntityRowSchema.array().safeParse(held);
    return rows.success ? rows.data : [];
  };
  const write = (rows) => storage.set({ [CHROME_CREDENTIAL_ROWS_KEY]: rows });
  const change = (work) => {
    const next = queue.then(async () => work(await read()));
    queue = next.catch(() => void 0);
    return next;
  };
  return {
    async list(entityType) {
      if (entityType !== CREDENTIAL_ENTITY_TYPE) return [];
      await queue;
      return read();
    },
    create: (_entityType, data) => change(async (rows) => {
      const id = globalThis.crypto.randomUUID();
      await write([...rows, { ...data, id }]);
      return { id };
    }),
    update: (_entityType, id, data) => change(async (rows) => {
      await write(rows.map((row) => row.id === id ? { ...row, ...data, id } : row));
    }),
    delete: (_entityType, id) => change(async (rows) => {
      await write(rows.filter((row) => row.id !== id));
    })
  };
}
function randomMasterKey() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function createChromeCredentialStore(storage) {
  const held = (await storage.get(CHROME_CREDENTIAL_MASTER_KEY))[CHROME_CREDENTIAL_MASTER_KEY];
  let masterKey = typeof held === "object" && "key" in held && typeof held.key === "string" ? held.key : void 0;
  if (masterKey === void 0) {
    masterKey = randomMasterKey();
    await storage.set({ [CHROME_CREDENTIAL_MASTER_KEY]: { key: masterKey } });
  }
  const store = new CredentialStore(chromeCredentialRows(storage), masterKey);
  await store.warm();
  return store;
}

// src/host/errors.ts
var ChromePortError = class extends Error {
  code;
  details;
  constructor(message, code, details = {}) {
    super(message);
    this.name = "ChromePortError";
    this.code = code;
    this.details = details;
  }
};
function isAborted(signal) {
  return signal !== void 0 && signal.aborted;
}
function cancelled() {
  return new ChromePortError("The call was cancelled", "CANCELLED");
}

// src/host/prompt.ts
var PROMPT_TIMEOUT_MS = 3e4;
function chromePromptModel(lookup, options = {}) {
  const timeoutMs = options.timeoutMs ?? PROMPT_TIMEOUT_MS;
  let base;
  return {
    availability: async () => {
      const lm = lookup();
      return lm ? lm.availability() : "unavailable";
    },
    prompt: async (text, schema, signal) => {
      const lm = lookup();
      if (!lm) throw new ChromePortError("This browser has no Prompt API", "MODEL_UNAVAILABLE");
      if (isAborted(signal)) throw cancelled();
      base ??= lm.create();
      let session;
      try {
        session = await (await base).clone();
      } catch (err) {
        base = void 0;
        throw err;
      }
      if (isAborted(signal)) {
        session.destroy();
        throw cancelled();
      }
      const abort = new AbortController();
      let timer;
      let onCallerAbort;
      const stopped = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ChromePortError(`The on-device model did not answer within ${timeoutMs}ms`, "TIMEOUT_ERROR", { timeoutMs }));
          abort.abort();
        }, timeoutMs);
        onCallerAbort = () => {
          reject(cancelled());
          abort.abort();
        };
        signal?.addEventListener("abort", onCallerAbort, { once: true });
      });
      try {
        return await Promise.race([session.prompt(text, { responseConstraint: schema, signal: abort.signal }), stopped]);
      } finally {
        clearTimeout(timer);
        if (onCallerAbort !== void 0) signal?.removeEventListener("abort", onCallerAbort);
        session.destroy();
      }
    }
  };
}

// src/host/embedder.ts
function transformersEmbedder(load, options = {}) {
  const prefix = options.prefix ?? "";
  let loading;
  return {
    async embed(texts, signal) {
      if (isAborted(signal)) throw cancelled();
      loading ??= load().catch((err) => {
        loading = void 0;
        throw err;
      });
      const extract = await loading;
      if (isAborted(signal)) throw cancelled();
      const output = await extract(texts.map((t) => prefix + t), { pooling: "mean", normalize: true });
      return output.tolist();
    }
  };
}

// src/host/signIn.ts
async function firebaseSession(options, postBody) {
  const response = await options.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(options.apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postBody, requestUri: options.identity.getRedirectURL(), returnSecureToken: true })
  });
  if (!response.ok) throw new ChromePortError(`Sign-in failed (${response.status})`, "AUTH_ERROR");
  const signed = await response.json();
  if (typeof signed.refreshToken !== "string" || signed.refreshToken === "") throw new ChromePortError("Sign-in returned no session", "AUTH_ERROR");
  return { refreshToken: signed.refreshToken, email: typeof signed.email === "string" ? signed.email : "" };
}
function googleSignIn(options) {
  const now = options.now ?? Date.now;
  return async () => {
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: options.clientId,
      response_type: "id_token",
      redirect_uri: options.identity.getRedirectURL(),
      scope: "openid email",
      nonce: String(now())
    }).toString();
    let returned;
    try {
      returned = await options.identity.launchWebAuthFlow({ url: auth.toString(), interactive: true });
    } catch {
      return null;
    }
    const idToken = returned === void 0 ? null : new URLSearchParams(new URL(returned).hash.slice(1)).get("id_token");
    if (idToken === null || idToken === "") return null;
    const session = await firebaseSession(options, `id_token=${encodeURIComponent(idToken)}&providerId=google.com`);
    return { name: options.credential, value: session.refreshToken, label: session.email };
  };
}
var FIREBASE_KEYED_ORIGINS = ["https://securetoken.googleapis.com", "https://identitytoolkit.googleapis.com"];
function firebaseKeyedFetch(apiKey, send) {
  return (input, init) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(target);
    if (!FIREBASE_KEYED_ORIGINS.includes(url.origin) || url.searchParams.has("key")) return send(input, init);
    url.searchParams.set("key", apiKey);
    return send(url.href, init);
  };
}

export { CHROME_CREDENTIAL_MASTER_KEY, CHROME_CREDENTIAL_ROWS_KEY, ChromePortError, PROMPT_TIMEOUT_MS, chromeCredentialRows, chromePromptModel, chromeTabPort, createChromeCredentialStore, createExtensionHttpPorts, firebaseKeyedFetch, googleSignIn, transformersEmbedder };
