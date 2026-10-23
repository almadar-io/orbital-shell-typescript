import { isJsonObject } from '@almadar/core';

// src/kernel/oauth-port.ts
var PENDING_GRACE_MS = 60 * 60 * 1e3;
var NO_CALLER = "a provider connection needs a signed-in caller";
var NO_CONNECTIONS = "no OAuth connection store is installed on this host";
var NO_TAKE = "this host keeps no derived secrets to take";
var UNREADABLE = "a held OAuth credential is unreadable";
var pendingName = (state) => `oauth:grant:${state}`;
var connectionName = (provider) => `oauth:connection:${provider}`;
function parseObject(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(UNREADABLE);
  }
  if (!isJsonObject(value)) throw new Error(UNREADABLE);
  return value;
}
function textOf(object, name) {
  const value = object[name];
  if (typeof value !== "string") throw new Error(UNREADABLE);
  return value;
}
function textOrNull(object, name) {
  const value = object[name];
  if (value === void 0 || value === null) return null;
  if (typeof value !== "string") throw new Error(UNREADABLE);
  return value;
}
function textList(object, name) {
  const value = object[name];
  if (!Array.isArray(value)) throw new Error(UNREADABLE);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(UNREADABLE);
    return item;
  });
}
function objectOf(object, name) {
  const value = object[name];
  if (value === void 0 || !isJsonObject(value)) throw new Error(UNREADABLE);
  return value;
}
function grantOf(object) {
  return {
    provider: textOf(object, "provider"),
    redirectUri: textOf(object, "redirectUri"),
    verifier: textOf(object, "verifier"),
    subject: textOrNull(object, "subject"),
    scopes: textList(object, "scopes")
  };
}
function rowOf(object, provider) {
  const connected = object.connected;
  if (typeof connected !== "boolean") throw new Error(UNREADABLE);
  return {
    provider,
    connected,
    account: textOf(object, "account"),
    avatarUrl: textOf(object, "avatarUrl"),
    scope: textList(object, "scope"),
    connectedAt: textOf(object, "connectedAt")
  };
}
var disconnected = (provider) => ({ provider, connected: false, account: "", avatarUrl: "", scope: [], connectedAt: "" });
function createOAuthPort(options) {
  const secrets = () => typeof options.secrets === "function" ? options.secrets() : options.secrets;
  const now = options.now ?? Date.now;
  const subjects = /* @__PURE__ */ new Map();
  const mockTokens = /* @__PURE__ */ new Map();
  const mockRefresh = /* @__PURE__ */ new Map();
  const metadata = /* @__PURE__ */ new Map();
  const caller = (principal) => {
    if (principal === void 0 || principal === "") throw new Error(NO_CALLER);
    return principal;
  };
  const durable = async (held) => held.persist !== void 0 && held.durable !== void 0 && held.durable();
  const take = async (held, name, principal) => {
    if (held.take === void 0) throw new Error(NO_TAKE);
    return held.take(name, principal);
  };
  return {
    async answer(ask, principal) {
      switch (ask.ask) {
        case "pendingPut": {
          const held = secrets();
          const record = JSON.stringify({ grant: ask.grant, expiresAt: now() + ask.ttlMs });
          if (held.hold !== void 0) await held.hold(pendingName(ask.state), record, ask.ttlMs + PENDING_GRACE_MS, void 0);
          else await held.set(pendingName(ask.state), record, ask.ttlMs + PENDING_GRACE_MS, void 0);
          return { reply: "done" };
        }
        case "pendingTake": {
          const held = secrets();
          const name = pendingName(ask.state);
          const text = await take(held, name, void 0);
          if (text === void 0) return { reply: "taken", taken: { found: "missing" } };
          const record = parseObject(text);
          const expiresAt = record.expiresAt;
          if (typeof expiresAt !== "number") throw new Error(UNREADABLE);
          if (expiresAt < now()) return { reply: "taken", taken: { found: "expired" } };
          return { reply: "taken", taken: { found: "grant", grant: grantOf(objectOf(record, "grant")) } };
        }
        case "connectionAvailable":
          return { reply: "flag", value: await durable(secrets()) };
        case "connectionSave": {
          const held = secrets();
          if (held.persist === void 0 || !await durable(held)) throw new Error(NO_CONNECTIONS);
          const who = caller(principal);
          const row = {
            provider: ask.provider,
            connected: true,
            account: ask.grant.subject ?? "",
            avatarUrl: "",
            scope: ask.grant.scope ?? [],
            connectedAt: new Date(now()).toISOString()
          };
          await held.persist(connectionName(ask.provider), JSON.stringify({ row, grant: ask.grant }), who);
          return { reply: "row", row };
        }
        case "connectionStatus": {
          const text = await secrets().get(connectionName(ask.provider), caller(principal));
          return { reply: "row", row: text === void 0 ? disconnected(ask.provider) : rowOf(objectOf(parseObject(text), "row"), ask.provider) };
        }
        case "connectionRemove":
          await secrets().forget(connectionName(ask.provider), caller(principal));
          return { reply: "row", row: disconnected(ask.provider) };
        case "subjectRemember":
          subjects.set(ask.accessToken, ask.subject);
          return { reply: "done" };
        case "subjectLookup":
          return { reply: "subject", subject: subjects.get(ask.accessToken) ?? null };
        case "subjectForget":
          subjects.delete(ask.accessToken);
          return { reply: "done" };
        case "metadataGet":
          return { reply: "metadata", metadata: metadata.get(ask.issuer) ?? null };
        case "metadataPut":
          metadata.set(ask.issuer, ask.metadata);
          return { reply: "done" };
        case "clock":
          return { reply: "millis", value: now() };
        case "consent":
          return { reply: "code", code: options.consent === void 0 ? null : await options.consent({ authUrl: ask.authUrl, state: ask.state, redirectUri: ask.redirectUri }) };
        case "mockTokenPut":
          mockTokens.set(ask.accessToken, { refresh: ask.refreshToken, expiresAt: ask.expiresAtMs, provider: ask.provider });
          mockRefresh.set(ask.refreshToken, { access: ask.accessToken, provider: ask.provider });
          return { reply: "done" };
        case "mockTokenRefresh": {
          const old = mockRefresh.get(ask.refreshToken);
          if (old === void 0) return { reply: "flag", value: false };
          mockTokens.delete(old.access);
          const sub = subjects.get(old.access);
          subjects.delete(old.access);
          if (sub !== void 0) subjects.set(ask.newAccessToken, sub);
          mockTokens.set(ask.newAccessToken, { refresh: ask.refreshToken, expiresAt: ask.expiresAtMs, provider: old.provider });
          mockRefresh.set(ask.refreshToken, { access: ask.newAccessToken, provider: old.provider });
          return { reply: "flag", value: true };
        }
        case "mockTokenRevoke": {
          const held = mockTokens.get(ask.token);
          if (held !== void 0) {
            mockTokens.delete(ask.token);
            mockRefresh.delete(held.refresh);
            subjects.delete(ask.token);
            return { reply: "flag", value: true };
          }
          const issued = mockRefresh.get(ask.token);
          if (issued !== void 0) {
            mockRefresh.delete(ask.token);
            mockTokens.delete(issued.access);
            subjects.delete(issued.access);
            return { reply: "flag", value: true };
          }
          return { reply: "flag", value: false };
        }
        case "mockTokenCheck": {
          const held = mockTokens.get(ask.accessToken);
          if (held === void 0) return { reply: "mockToken", state: "missing", provider: null };
          if (now() > held.expiresAt) {
            mockTokens.delete(ask.accessToken);
            subjects.delete(ask.accessToken);
            return { reply: "mockToken", state: "expired", provider: null };
          }
          return { reply: "mockToken", state: "valid", provider: held.provider };
        }
      }
    }
  };
}

export { PENDING_GRACE_MS, createOAuthPort };
