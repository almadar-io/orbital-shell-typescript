import { isProgramEffect } from './chunk-HNOAZWFH.js';
import { systemRandom, base64Standard, sendBeaconRequest, streamHttp, sendHttp, checkOAuthReply } from './chunk-YO4LWS3I.js';
import { untilAborted } from './chunk-MZKIL5IN.js';
import { OnDeviceModelFailure, promptOnDevice, embedOnDevice } from './chunk-FWA5K7Q2.js';
import { WriteDeclinedError, isJsonObject, QueryDeclinedError, TabHostFailure, OrbitalEventRequestSchema, credentialStatusConnected } from '@almadar/core';

function issuePayload(issue) {
  const payload = { code: issue.code, message: issue.message };
  if (issue.path !== void 0) payload.path = issue.path;
  if (issue.line !== void 0) payload.line = issue.line;
  if (issue.column !== void 0) payload.column = issue.column;
  return payload;
}
function toJson(value) {
  return JSON.parse(JSON.stringify(value));
}
async function settle(work) {
  try {
    return { ok: await work() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
function serviceParams(args) {
  if (args === null) return void 0;
  if (!isJsonObject(args)) throw new Error("call-service: the arguments are not an object");
  return args;
}
function failureMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function callService(ports, request, scope) {
  const { service, method, args, key, caller, site } = request;
  const identity = caller !== void 0 ? { principal: caller.principal, ...caller.role !== void 0 ? { role: caller.role } : {} } : {};
  const orbital = site?.orbital ?? scope.orbital;
  const onMessage = site?.emit.onMessage;
  const message = (payload) => {
    if (site === void 0 || onMessage === void 0) return;
    ports.deliverLive({ orbital, trait: site.trait, event: onMessage }, payload, scope.originClientId);
  };
  const call = async (signal, outsideRequest) => {
    const host = site !== void 0 ? ports.servicePorts({ orbital, trait: site.trait }, scope.user, message, outsideRequest === true ? void 0 : scope.assertReentry) : void 0;
    const context = caller !== void 0 || signal !== void 0 || host !== void 0 || outsideRequest !== void 0 ? { ...identity, ...host !== void 0 ? { host } : {}, ...signal !== void 0 ? { signal } : {}, ...outsideRequest !== void 0 ? { outsideRequest } : {} } : void 0;
    const result = await ports.callService(service, method, serviceParams(args), context);
    return result === null ? null : toJson(result);
  };
  const deferred = site?.followOn === true ? ports.deferCallOutcome() : void 0;
  if (site !== void 0 && deferred !== void 0) {
    startDeferredCall(deferred, site, key, call, { ports, orbital, scope });
    return { kind: "serviceDeferred" };
  }
  const run = async () => {
    if (key === void 0) return { kind: "service", result: { ok: await call() } };
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, call(signal)));
    return outcome.cancelled ? { kind: "serviceCancelled" } : { kind: "service", result: { ok: outcome.value } };
  };
  try {
    return await (scope.outsideEventQueue !== void 0 ? scope.outsideEventQueue(run) : run());
  } catch (error) {
    return { kind: "service", result: { error: failureMessage(error) } };
  }
}
function startDeferredCall(defer, site, key, call, context) {
  const { ports, orbital, scope } = context;
  const deliver = (event, payload) => defer({
    orbital,
    traitName: site.trait,
    event,
    payload,
    entityId: scope.entityId,
    originClientId: scope.originClientId,
    user: scope.user,
    locale: scope.locale
  });
  const outcome = key === void 0 ? call(void 0, true).then((value) => ({ cancelled: false, value })) : ports.inFlightCalls.run(key, (signal) => untilAborted(signal, call(signal, true)));
  void outcome.then(
    (settled) => {
      if (settled.cancelled) {
        if (site.emit.cancelled !== void 0 && key !== void 0) deliver(site.emit.cancelled, { key });
      } else if (site.emit.success !== void 0) {
        deliver(site.emit.success, keyed(settled.value === null ? void 0 : toEventPayload(settled.value), key));
      }
    },
    (error) => {
      if (site.emit.failure !== void 0) deliver(site.emit.failure, keyed({ error: failureMessage(error) }, key));
    }
  );
}
function keyed(payload, key) {
  return payload !== void 0 && key !== void 0 ? { ...payload, key } : payload;
}
function toEventPayload(value) {
  return isJsonObject(value) ? value : void 0;
}
async function substrate(ports, request, scope) {
  const { key, site } = request;
  const sink = ports.deferCallOutcome();
  const complete = ports.substrateCompletion;
  if (key === void 0 || site === void 0 || sink === void 0 || complete === void 0) return substrateInPlace(ports, request, scope);
  const source = site.emit.onMessage !== void 0 ? ports.substrateStream?.(request.op, request.args, scope) : void 0;
  if (ports.inFlightCalls.inFlight(key)) return { kind: "substrate", result: { error: { message: source !== void 0 ? `key ${key} already has a stream open` : `key ${key} already has a completion pending`, errors: [] } } };
  const deliver = (fired) => {
    if (fired !== null) sink({ orbital: site.orbital ?? scope.orbital, traitName: site.trait, event: fired.event, payload: isJsonObject(fired.payload) ? fired.payload : void 0, entityId: site.entityId, originClientId: scope.originClientId, user: scope.user, locale: scope.locale });
  };
  const failed = (error) => deliver(complete(site, key, request.op, { error: { message: failureMessage(error), errors: [] } }));
  if (source !== void 0 && ports.substrateMessage !== void 0) {
    const message = ports.substrateMessage;
    void ports.inFlightCalls.run(key, (signal) => new Promise((resolve) => {
      let unsubscribe;
      let ended = false;
      const end = () => {
        ended = true;
        unsubscribe?.();
        signal.removeEventListener("abort", end);
        resolve();
      };
      signal.addEventListener("abort", end, { once: true });
      unsubscribe = source.subscribe((value) => {
        if (signal.aborted) return;
        const fired = message(site, key, value);
        deliver(fired);
      }, end);
      if (ended) unsubscribe();
    })).catch(failed);
    return { kind: "serviceDeferred" };
  }
  const pending = ports.inFlightCalls.run(key, (signal) => untilAborted(signal, substrateInPlace(ports, request, { ...scope, assertReentry: void 0 })));
  void pending.then((outcome) => {
    if (outcome.cancelled || outcome.value.kind !== "substrate") return;
    deliver(complete(site, key, request.op, outcome.value.result));
  }, failed);
  return { kind: "serviceDeferred" };
}
async function substrateInPlace(ports, request, scope) {
  if (request.op === "program/live") return { kind: "substrate", result: { error: { message: "program/live streams to its onMessage route: give it a key and an onMessage route", errors: [] } } };
  const handler = ports.programEffect();
  const failure = (message, errors = []) => {
    const detail = { message, errors };
    return { kind: "substrate", result: { error: detail } };
  };
  if (request.op === "program/dispatch" || request.op === "program/inputs") {
    const lent = ports.servicePorts({ orbital: scope.orbital, trait: "" }, scope.user, () => {
    }, scope.assertReentry);
    try {
      const delivered = await deliverAgentAsk(request.op, request.args, lent);
      if (delivered.ok) return { kind: "substrate", result: { ok: delivered.result } };
      return failure(delivered.error, delivered.errors ?? []);
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  }
  if (handler === void 0) return failure(`no program host configured for ${request.op}`);
  if (!isProgramEffect(request.op)) return failure(`no program host configured for ${request.op}`);
  try {
    const user = scope.user;
    const outcome = await handler(request.op, request.args, user !== void 0 ? { principal: user.id, ...user.role !== void 0 ? { role: user.role } : {} } : void 0);
    if (outcome.ok) return { kind: "substrate", result: { ok: toJson(outcome.result) } };
    return failure(outcome.error, (outcome.errors ?? []).map((issue) => toJson(issuePayload(issue))));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
function present(value) {
  if (value === void 0 || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isJsonObject(value)) return Object.keys(value).length > 0;
  return true;
}
async function deliverAgentAsk(op, args, host) {
  const [first, second, third] = args;
  if (op === "program/inputs") {
    const steps = args.length === 1 && isJsonObject(first) ? first["trace"] : void 0;
    if (typeof steps !== "number") return { ok: false, error: "program/inputs: the host is asked for { trace } only" };
    if (host.trace === void 0) return { ok: false, error: "program/inputs: this host keeps no dispatch trace" };
    return { ok: true, result: host.trace(steps) };
  }
  if (args.length === 1 && isJsonObject(first)) {
    const { inbound, body, headers } = first;
    if (typeof inbound !== "string" || typeof body !== "string" || !isJsonObject(headers)) return { ok: false, error: "program/dispatch: the host is asked for { inbound, body, headers }" };
    if (host.deliverInbound === void 0) return { ok: false, error: "program/dispatch: this host does not deliver inbound requests" };
    const named = {};
    for (const [key, value] of Object.entries(headers)) if (typeof value === "string") named[key] = value;
    const answer = await host.deliverInbound(inbound, { headers: named, rawBody: body });
    return { ok: true, result: { status: answer.status, body: answer.body } };
  }
  if (typeof first !== "string" || second === void 0 || !isJsonObject(second)) return { ok: false, error: "program/dispatch: the host is asked for a qualified address and a payload record" };
  const payload = second;
  if (isJsonObject(third)) {
    if (host.dispatchRequest === void 0) return { ok: false, error: "program/dispatch: this host does not serve event requests" };
    const stream = third["stream"] === true;
    if (stream && host.supportsDispatchStream !== true) return { ok: false, error: "program/dispatch: this host does not answer stream items" };
    const fields = { payload };
    for (const key of ["event", "entityId", "targetTrait", "clientId", "locale", "delivery", "dispatchLog", "mount"]) {
      const value = third[key];
      if (present(value)) fields[key] = value;
    }
    const traits = third["traits"];
    if (traits !== void 0 && traits !== null) fields["traits"] = traits;
    if (isJsonObject(third["viewer"])) fields["user"] = third["viewer"];
    const parsed = OrbitalEventRequestSchema.safeParse(fields);
    if (!parsed.success) {
      const message = `program/dispatch: not an event request: ${parsed.error.message}`;
      return { ok: false, error: message, errors: [{ code: "INVALID_REQUEST", message, status: 400 }] };
    }
    const orbital = typeof third["orbital"] === "string" ? third["orbital"] : "";
    const answered = await host.dispatchRequest(orbital, parsed.data, third["input"] === true, stream);
    if (!answered.ok) return { ok: false, error: answered.error, errors: [{ code: answered.code, message: answered.error, status: answered.status }] };
    if (!stream) return { ok: true, result: toJson(answered.response) };
    if (answered.streamItems === void 0) return { ok: false, error: "program/dispatch: this host does not answer stream items" };
    return { ok: true, result: toJson({ ...answered.response, items: answered.streamItems }) };
  }
  const event = first.lastIndexOf(".");
  const trait = first.lastIndexOf(".", event - 1);
  if (event < 0 || trait < 0) return { ok: false, error: `program/dispatch: '${first}' is not a qualified address` };
  const response = await host.dispatchInput(first.slice(0, trait), { targetTrait: first.slice(trait + 1, event), event: first.slice(event + 1), payload });
  return { ok: true, result: toJson(response) };
}
var HTTP_UNAVAILABLE = "HTTP_KERNEL_UNAVAILABLE: this host was given no http ports";
function httpAnswer(exchange) {
  return { kind: "http", result: exchange.kind === "reply" ? { ok: exchange.response } : { error: exchange.failure } };
}
async function http(ports, request, scope) {
  const exchangePorts = ports.http;
  if (exchangePorts === void 0) return { kind: "http", result: { error: { kind: "failed", message: HTTP_UNAVAILABLE } } };
  const { key, site } = request;
  const orbital = site?.orbital ?? scope.orbital;
  const onMessage = site?.emit.onMessage;
  const onEvent = (event) => {
    if (site === void 0 || onMessage === void 0) return;
    ports.deliverLive({ orbital, trait: site.trait, event: onMessage }, { ...event }, scope.originClientId);
  };
  const send = (signal) => request.kind === "httpStream" ? streamHttp(exchangePorts, request.request, { framing: request.framing, key: key ?? null }, onEvent, signal) : sendHttp(exchangePorts, request.request, signal, request.delayMs);
  const run = async () => {
    if (key === void 0) return httpAnswer(await send());
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, send(signal)));
    return outcome.cancelled ? { kind: "serviceCancelled" } : httpAnswer(outcome.value);
  };
  try {
    return await (scope.outsideEventQueue !== void 0 ? scope.outsideEventQueue(run) : run());
  } catch (error) {
    return { kind: "http", result: { error: { kind: "failed", message: failureMessage(error) } } };
  }
}
async function httpBeacon(ports, request, scope) {
  const exchangePorts = ports.http;
  if (exchangePorts === void 0) return { kind: "httpBeacon", result: { ok: { via: "unavailable", message: HTTP_UNAVAILABLE } } };
  const { key } = request;
  const send = async (signal) => ({ kind: "httpBeacon", result: await sendBeaconRequest(exchangePorts, request.request, signal) });
  const run = async () => {
    if (key === void 0) return send();
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, send(signal)));
    return outcome.cancelled ? { kind: "serviceCancelled" } : outcome.value;
  };
  try {
    return await (scope.outsideEventQueue !== void 0 ? scope.outsideEventQueue(run) : run());
  } catch (error) {
    return { kind: "httpBeacon", result: { error: { kind: "failed", message: failureMessage(error) } } };
  }
}
async function onDeviceModel(ports, request, scope) {
  const { key } = request;
  const ask = async (signal) => request.kind === "prompt" ? { kind: "prompt", result: { ok: await promptOnDevice(ports.onDevice, request.text, request.schema, key ?? null, signal) } } : { kind: "embed", result: { ok: await embedOnDevice(ports.onDevice, request.texts, key ?? null, signal) } };
  const run = async () => {
    if (key === void 0) return ask();
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, ask(signal)));
    return outcome.cancelled ? { kind: "serviceCancelled" } : outcome.value;
  };
  try {
    return await (scope.outsideEventQueue !== void 0 ? scope.outsideEventQueue(run) : run());
  } catch (error) {
    const failure = error instanceof OnDeviceModelFailure ? { kind: error.kind, message: error.message } : { kind: "failed", message: failureMessage(error) };
    return request.kind === "prompt" ? { kind: "prompt", result: { error: failure } } : { kind: "embed", result: { error: failure } };
  }
}
var NO_TAB_HOST = "browser/tab: no host answers browser tabs";
async function tab(ports, request, scope) {
  const { ask, key } = request;
  const port = ports.tabs;
  if (port === void 0) return { kind: "tab", result: { error: { kind: "unavailable", message: NO_TAB_HOST } } };
  const deliver = (payload) => {
    if (ask.kind !== "watch") return;
    const target = ask.deliver;
    const lent = ports.servicePorts({ orbital: target.orbital, trait: target.trait }, scope.user, () => {
    });
    void lent.dispatchInput(target.orbital, { targetTrait: target.trait, event: target.event, payload });
  };
  const perform = async (signal) => {
    try {
      return { kind: "tab", result: { ok: await port.perform(ask, { ...signal !== void 0 ? { signal } : {}, deliver }) } };
    } catch (error) {
      if (error instanceof TabHostFailure) return { kind: "tab", result: { error: { kind: error.kind, message: error.message } } };
      return { kind: "tab", result: { error: { kind: "failed", message: failureMessage(error) } } };
    }
  };
  const run = async () => {
    if (key === void 0) return perform();
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, perform(signal)));
    return outcome.cancelled ? { kind: "serviceCancelled" } : outcome.value;
  };
  return scope.outsideEventQueue !== void 0 ? scope.outsideEventQueue(run) : run();
}
async function pageFacts(ports, request) {
  return { kind: "pageFacts", result: await settle(async () => ports.pageFacts?.(request.fields) ?? { available: false, hostname: "", referrer: "", screenWidth: null }) };
}
async function osAnswer(ports, request, scope) {
  const { os } = ports;
  if (os === void 0) return { kind: "os", result: { error: { kind: "denied", message: `${request.op}: no os host configured` } } };
  const { op, args, key, site } = request;
  const completions = ports.osCompletions;
  const sink = ports.deferCallOutcome();
  const message = ports.substrateMessage;
  if (key !== void 0 && site !== void 0 && completions !== void 0 && sink !== void 0 && message !== void 0 && os.stream !== void 0 && completions.streams(op)) {
    const orbital = site.orbital ?? scope.orbital;
    const lease = ports.inFlightCalls.reserve(key);
    if (lease === void 0) return { kind: "os", result: { error: { kind: "invalid", message: `${op}: key ${key} already has a stream open` } } };
    const stop = () => {
      os.cancel?.(key);
      lease.release();
    };
    lease.signal.addEventListener("abort", stop, { once: true });
    const deliver = (fired) => {
      if (fired === null || lease.signal.aborted) return false;
      sink({ orbital, traitName: site.trait, event: fired.event, payload: isJsonObject(fired.payload) ? fired.payload : void 0, entityId: site.entityId, originClientId: scope.originClientId, user: scope.user, locale: scope.locale });
      return true;
    };
    const started = await os.stream(op, args, key, (value) => deliver(message(site, key, value)), (error) => {
      lease.release();
      lease.signal.removeEventListener("abort", stop);
      deliver(completions.event(site, key, { error }));
    });
    if ("error" in started) {
      lease.release();
      lease.signal.removeEventListener("abort", stop);
    }
    return { kind: "os", result: started };
  }
  if (key !== void 0 && site !== void 0 && completions !== void 0 && sink !== void 0 && os.defer !== void 0 && completions.defers(op)) {
    const orbital = site.orbital ?? scope.orbital;
    const lease = ports.inFlightCalls.reserve(key);
    if (lease === void 0) return { kind: "os", result: { error: { kind: "invalid", message: `${op}: key ${key} already has a completion pending` } } };
    const cancel = () => {
      os.cancel?.(key);
      lease.release();
    };
    lease.signal.addEventListener("abort", cancel, { once: true });
    const started = os.defer(op, args, key, (outcome) => {
      lease.release();
      lease.signal.removeEventListener("abort", cancel);
      if (lease.signal.aborted) return;
      const fired = completions.event(site, key, outcome);
      if (fired === null) return;
      sink({
        orbital,
        traitName: site.trait,
        event: fired.event,
        payload: isJsonObject(fired.payload) ? fired.payload : void 0,
        entityId: site.entityId,
        originClientId: scope.originClientId,
        user: scope.user,
        locale: scope.locale
      });
    });
    if ("error" in started) {
      lease.release();
      lease.signal.removeEventListener("abort", cancel);
    }
    return "error" in started ? { kind: "os", result: started } : { kind: "serviceDeferred" };
  }
  return { kind: "os", result: await os.answer(op, args) };
}
async function secret(ports, request) {
  const store = ports.http?.secrets;
  if (store === void 0) return { kind: "secret", result: { error: HTTP_UNAVAILABLE } };
  return { kind: "secret", result: await settle(async () => await store.get(request.name, request.principal) ?? null) };
}
async function secretSet(ports, request) {
  const store = ports.http?.secrets;
  if (store === void 0) return { kind: "secretSet", result: { error: HTTP_UNAVAILABLE } };
  return { kind: "secretSet", result: await settle(async () => {
    await store.set(request.name, request.value, request.ttlMs, request.principal);
    return null;
  }) };
}
async function secretRotate(ports, request) {
  const store = ports.http?.secrets;
  if (store === void 0) return { kind: "secretRotate", result: { error: HTTP_UNAVAILABLE } };
  const rotate = store.rotate;
  if (rotate === void 0) return { kind: "secretRotate", result: { error: "this host keeps no rotatable credentials" } };
  return { kind: "secretRotate", result: await settle(async () => {
    await rotate.call(store, request.name, request.value, request.principal);
    return null;
  }) };
}
function random(ports, request) {
  const source = ports.http?.random ?? systemRandom;
  try {
    return { kind: "random", result: { ok: base64Standard(source(request.bytes)) } };
  } catch (error) {
    return { kind: "random", result: { error: failureMessage(error) } };
  }
}
async function credentialStatus(ports, request) {
  const store = ports.http?.secrets;
  if (store === void 0) return { kind: "credentialStatus", result: { error: HTTP_UNAVAILABLE } };
  return { kind: "credentialStatus", result: await settle(async () => {
    const connected = credentialStatusConnected(await store.get(request.name, request.principal), request.principal);
    const label = connected ? await store.label?.(request.name, request.principal) : void 0;
    return { connected, ...label !== void 0 ? { label } : {} };
  }) };
}
async function credentialForget(ports, request) {
  const store = ports.http?.secrets;
  if (store === void 0) return { kind: "credentialForget", result: { error: HTTP_UNAVAILABLE } };
  return { kind: "credentialForget", result: await settle(async () => {
    await store.forget(request.name, request.principal);
    return null;
  }) };
}
async function credentialAdmin(ports, work) {
  const port = ports.http?.credentials;
  if (port === void 0) return { error: HTTP_UNAVAILABLE };
  return settle(() => work(port));
}
async function oauth(ports, request) {
  const port = ports.http?.oauth;
  if (port === void 0) return { kind: "oauth", result: { error: "this host keeps no OAuth state" } };
  return { kind: "oauth", result: await settle(async () => checkOAuthReply(await port.answer(request.ask, request.principal))) };
}
function rowData(value) {
  if (!isJsonObject(value)) throw new Error("persist: the row is not an object");
  return value;
}
async function queryRows(persistence, request) {
  const { entityType, query, project } = request;
  try {
    if (project === "ids") {
      if (!persistence.queryIds) return { kind: "queryUnsupported", reason: "no-ids-capability" };
      return { kind: "idPage", result: { ok: await persistence.queryIds(entityType, query) } };
    }
    if (!persistence.queryPage) return { kind: "queryUnsupported", reason: "no-query-capability" };
    return { kind: "page", result: { ok: await persistence.queryPage(entityType, query) } };
  } catch (error) {
    if (error instanceof QueryDeclinedError) return { kind: "queryUnsupported", reason: error.reason };
    return { kind: project === "ids" ? "idPage" : "page", result: { error: failureMessage(error) } };
  }
}
async function commitRows(persistence, request) {
  if (!persistence.commitRows) return { kind: "committed", result: { error: "this store does not commit rows" } };
  try {
    return { kind: "committed", result: { ok: await persistence.commitRows(request.rows) } };
  } catch (error) {
    return { kind: "committed", result: { error: failureMessage(error) } };
  }
}
async function writeRows(persistence, request) {
  const { batch } = request;
  try {
    if (!persistence.writeBatch) return { kind: "writeUnsupported", reason: "no-write-capability" };
    return { kind: "wrote", result: { ok: await persistence.writeBatch(batch) } };
  } catch (error) {
    if (error instanceof WriteDeclinedError) return { kind: "writeUnsupported", reason: error.reason };
    return { kind: "wrote", result: { error: failureMessage(error) } };
  }
}
function declareCapabilities(persistence, declare, entityTypes) {
  for (const entityType of entityTypes) {
    const query = persistence.queryPage ? persistence.queryCapabilities?.(entityType) : void 0;
    const write = persistence.writeWhere || persistence.writeBatch || persistence.commitRows ? persistence.writeCapabilities?.(entityType) : void 0;
    if (query === void 0 && write === void 0) continue;
    declare(entityType, JSON.stringify(query ?? null), JSON.stringify(write ?? null));
  }
}
async function answerRequest(ports, request, scope) {
  const { persistence } = ports;
  switch (request.kind) {
    case "readRow":
      return {
        kind: "row",
        result: await settle(async () => {
          const row = await persistence.getById(request.entityType, request.id);
          return row;
        })
      };
    case "listRows":
      return {
        kind: "rows",
        result: await settle(async () => await persistence.list(request.entityType))
      };
    case "queryRows":
      return queryRows(persistence, request);
    case "writeRows":
      return writeRows(persistence, request);
    case "commitRows":
      return commitRows(persistence, request);
    case "createRow":
      return {
        kind: "row",
        result: await settle(async () => {
          const data = rowData(request.data);
          const { id } = await persistence.create(request.entityType, data);
          return await persistence.getById(request.entityType, id) ?? { ...data, id };
        })
      };
    case "writeRow":
      return {
        kind: "row",
        result: await settle(async () => {
          const data = rowData(request.data);
          const existing = await persistence.getById(request.entityType, request.id);
          if (existing === null) await persistence.create(request.entityType, { ...data, id: request.id });
          else await persistence.update(request.entityType, request.id, { ...data, id: request.id });
          return await persistence.getById(request.entityType, request.id) ?? { ...existing, ...data, id: request.id };
        })
      };
    case "deleteRow":
      return {
        kind: "deleted",
        result: await settle(async () => {
          await persistence.delete(request.entityType, request.id);
          return null;
        })
      };
    case "callService":
      return callService(ports, request, scope);
    case "cancelCall":
      ports.inFlightCalls.cancel(request.key);
      ports.os?.cancel?.(request.key);
      return { kind: "cancelled", result: { ok: null } };
    case "substrate":
      return substrate(ports, request, scope);
    case "http":
    case "httpStream":
      return http(ports, request, scope);
    case "httpBeacon":
      return httpBeacon(ports, request, scope);
    case "pageFacts":
      return pageFacts(ports, request);
    case "prompt":
    case "embed":
      return onDeviceModel(ports, request, scope);
    case "tab":
      return tab(ports, request, scope);
    case "secret":
      return secret(ports, request);
    case "secretSet":
      return secretSet(ports, request);
    case "secretRotate":
      return secretRotate(ports, request);
    case "random":
      return random(ports, request);
    case "os":
      return osAnswer(ports, request, scope);
    case "clock":
      return { kind: "clock", result: { ok: (ports.now ?? Date.now)() } };
    case "deliver":
      return { kind: "deliver", result: { error: { kind: "down", id: request.envelope.id } } };
    case "credentialStatus":
      return credentialStatus(ports, request);
    case "credentialForget":
      return credentialForget(ports, request);
    case "credentialStoreList":
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.list()) };
    case "credentialStoreRead":
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.read(request.name)) };
    case "credentialStoreWrite":
      return { kind: request.kind, result: await credentialAdmin(ports, async (port) => {
        await port.write(request.service, request.name, request.value);
        return null;
      }) };
    case "credentialStoreRemove":
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.remove(request.name)) };
    case "credentialStoreRotate":
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.rotate()) };
    case "credentialModeRead":
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.mode()) };
    case "credentialModeWrite":
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.setMode(request.mode)) };
    case "oauth":
      return oauth(ports, request);
  }
}

export { answerRequest, declareCapabilities, writeRows };
