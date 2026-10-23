import { createLogger } from '@almadar/logger';
import { RowQueryPageSchema, OrbitalRegisterResponseSchema } from '@almadar/core';

// src/client/EventTransport.ts
var log = createLogger("almadar:runtime:event-transport");
function deriveCarriesCircuitState(topology) {
  return topology !== "stateful";
}
async function authHeaders(getAccessToken) {
  const headers = { "Content-Type": "application/json" };
  const token = getAccessToken ? await getAccessToken() : void 0;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
function deriveEventsUrl(serverUrl) {
  const trimmed = serverUrl.replace(/\/+$/, "");
  const apiRoot = trimmed.replace(/\/[^/]*$/, "");
  return `${apiRoot}/events`;
}
function isBusPushEnvelope(value) {
  return value.type === "bus" && typeof value.event === "string";
}
function isDispatchPushEnvelope(value) {
  return value.type === "dispatch" && typeof value.orbitalName === "string" && value.request !== void 0 && value.response !== void 0;
}
var EVENT_SOURCE_CLOSED = 2;
var REOPEN_DELAY_MS = 1e3;
var pushChannels = /* @__PURE__ */ new Map();
function parseFrameNumber(id) {
  const dash = id.lastIndexOf("-");
  if (dash <= 0) return void 0;
  const n = Number(id.slice(dash + 1));
  return Number.isInteger(n) ? { boot: id.slice(0, dash), n } : void 0;
}
var lastFrameByClient = /* @__PURE__ */ new Map();
function acquirePushChannel(key, resolveUrl, resumeKey, subscriber) {
  let channel = pushChannels.get(key);
  if (channel === void 0) {
    const created = { source: void 0, subscribers: /* @__PURE__ */ new Set(), closed: false };
    const open = async () => {
      let url;
      try {
        url = await resolveUrl();
      } catch (err) {
        log.error("push:open-failed", { error: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (created.closed) return;
      const source = new EventSource(url);
      created.source = source;
      source.onmessage = (ev) => {
        let parsed;
        try {
          parsed = JSON.parse(ev.data);
        } catch (err) {
          log.warn("push:parse-failed", { error: err instanceof Error ? err.message : String(err) });
          return;
        }
        const number = ev.lastEventId ? parseFrameNumber(ev.lastEventId) : void 0;
        if (number !== void 0 && resumeKey !== void 0) {
          const seen = lastFrameByClient.get(resumeKey);
          if (seen !== void 0 && seen.boot === number.boot && number.n <= seen.n) return;
          lastFrameByClient.set(resumeKey, number);
        }
        for (const sub of created.subscribers) sub(parsed);
      };
      source.onerror = () => {
        log.warn("push:connection-error", { channel: key });
        if (source.readyState === EVENT_SOURCE_CLOSED && !created.closed) {
          created.source = void 0;
          setTimeout(() => {
            if (!created.closed) void open();
          }, REOPEN_DELAY_MS);
        }
      };
    };
    pushChannels.set(key, created);
    void open();
    channel = created;
  }
  channel.subscribers.add(subscriber);
  return () => {
    channel.subscribers.delete(subscriber);
    if (channel.subscribers.size === 0) {
      channel.closed = true;
      channel.source?.close();
      pushChannels.delete(key);
    }
  };
}
var COMPRESSED_BODY_MIN_BYTES = 32 * 1024;
async function encodeJsonBody(value, compress) {
  const text = JSON.stringify(value);
  if (!compress || text.length < COMPRESSED_BODY_MIN_BYTES || typeof CompressionStream === "undefined") return { body: text };
  const bytes = new TextEncoder().encode(text);
  const source = new ReadableStream({ start(controller) {
    controller.enqueue(bytes);
    controller.close();
  } });
  const gzipped = source.pipeThrough(new CompressionStream("gzip"));
  return { body: new Uint8Array(await new Response(gzipped).arrayBuffer()), encoding: "gzip" };
}
async function jsonPost(fetchFn, url, value, getAccessToken, compress) {
  const headers = await authHeaders(getAccessToken);
  const { body, encoding } = await encodeJsonBody(value, compress);
  if (encoding) headers["Content-Encoding"] = encoding;
  return fetchFn(url, { method: "POST", headers, body });
}
function createHttpTransport(options) {
  const { serverUrl, getAccessToken } = options;
  const fetchFn = options.fetch ?? fetch.bind(globalThis);
  const compress = options.compressRequests === true;
  let behavior;
  const openPushChannel = (params, subscriber) => {
    if (typeof EventSource === "undefined") return () => {
    };
    const eventsUrl = deriveEventsUrl(serverUrl);
    const resumeKey = params["clientId"] !== void 0 ? `${eventsUrl}|${params["clientId"]}` : void 0;
    const withResume = (search) => {
      const seen = resumeKey !== void 0 ? lastFrameByClient.get(resumeKey) : void 0;
      if (seen !== void 0) search.set("since", `${seen.boot}-${seen.n}`);
      return `${eventsUrl}?${search.toString()}`;
    };
    const key = `${eventsUrl}?${new URLSearchParams(params).toString()}`;
    const resolveUrl = async () => {
      const reply = await fetchFn(`${eventsUrl}/ticket`, { method: "POST", headers: await authHeaders(getAccessToken) });
      if (!reply.ok) throw new Error(`the server refused a stream ticket: ${reply.status}`);
      const body = await reply.json();
      if (typeof body.ticket !== "string" || body.ticket.length === 0) throw new Error("the server sent no stream ticket");
      return withResume(new URLSearchParams({ ...params, ticket: body.ticket }));
    };
    return acquirePushChannel(key, resolveUrl, resumeKey, subscriber);
  };
  return {
    async register(schema) {
      behavior = schema.name;
      try {
        const res = await jsonPost(fetchFn, `${serverUrl}/register`, { schema }, getAccessToken, compress);
        const parsed = OrbitalRegisterResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          log.error("register:malformed-response", { issues: JSON.stringify(parsed.error.issues) });
          return { success: false, carriesCircuitState: deriveCarriesCircuitState(void 0) };
        }
        return {
          success: parsed.data.success,
          carriesCircuitState: deriveCarriesCircuitState(parsed.data.topology)
        };
      } catch (err) {
        if (err instanceof TypeError) {
          log.warn("register:failed", { error: err.message });
        } else {
          log.error("register:failed", { error: err instanceof Error ? err : String(err) });
        }
        return { success: false, carriesCircuitState: true };
      }
    },
    async unregister() {
      try {
        await fetchFn(`${serverUrl}/unregister`, { method: "DELETE", headers: await authHeaders(getAccessToken) });
      } catch (error) {
        log.warn("unregister-failed", { error: error instanceof Error ? error.message : String(error) });
      }
    },
    async send(orbitalName, request) {
      const res = await jsonPost(
        fetchFn,
        `${serverUrl}/${orbitalName}/events`,
        request.behavior === void 0 && behavior !== void 0 ? { ...request, behavior } : request,
        getAccessToken,
        compress
      );
      return await res.json();
    },
    async resolveRows(reference) {
      const res = await jsonPost(fetchFn, `${serverUrl}/resolve-rows`, { ref: reference }, getAccessToken, compress);
      if (!res.ok) throw new Error(`resolve-rows: the server answered ${res.status}`);
      return RowQueryPageSchema.parse(await res.json());
    },
    subscribe(onPush, params = {}) {
      return openPushChannel(params, (envelope) => {
        if (isBusPushEnvelope(envelope)) onPush({ event: envelope.event, payload: envelope.payload, source: envelope.source }, envelope.target ?? "peers");
      });
    },
    subscribeHostDispatches(onDispatch, params = {}) {
      return openPushChannel(params, (envelope) => {
        if (isDispatchPushEnvelope(envelope)) onDispatch(envelope.orbitalName, envelope.request, envelope.response);
      });
    }
  };
}
function createInProcessTransport(evaluate, options = {}) {
  return {
    async register(schema) {
      await options.onRegister?.(schema);
      return { success: true, carriesCircuitState: options.carriesCircuitState ?? false };
    },
    async unregister() {
      await options.onUnregister?.();
    },
    async send(orbitalName, request) {
      return evaluate(orbitalName, request);
    },
    ...options.resolveRows !== void 0 ? { resolveRows: options.resolveRows } : {}
    // No `subscribe` — an in-process transport has no server to push from.
  };
}

export { COMPRESSED_BODY_MIN_BYTES, createHttpTransport, createInProcessTransport, deriveCarriesCircuitState, encodeJsonBody };
