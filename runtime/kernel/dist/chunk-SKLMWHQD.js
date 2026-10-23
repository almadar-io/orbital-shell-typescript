// src/client/channel-transport.ts
var CLOSED = "The host closed the channel before answering";
function createChannelTransport(channel, options = {}) {
  let next = 1;
  const pending = /* @__PURE__ */ new Map();
  channel.onMessage((message) => {
    if (message.almadarChannel !== "registered" && message.almadarChannel !== "reply") return;
    const settle = pending.get(message.id);
    if (!settle) return;
    pending.delete(message.id);
    settle(message);
  });
  let closed = false;
  const closedReply = (id) => ({
    almadarChannel: "reply",
    id,
    response: { success: false, transitioned: false, states: {}, emittedEvents: [], error: CLOSED }
  });
  channel.onClose?.(() => {
    closed = true;
    for (const [id, settle] of pending) settle(closedReply(id));
    pending.clear();
  });
  const request = (build) => new Promise((resolve) => {
    const id = next++;
    if (closed) {
      resolve(closedReply(id));
      return;
    }
    pending.set(id, resolve);
    channel.post(build(id));
  });
  return {
    hostsBrowserStore: options.hostsBrowserStore === true,
    async register(schema) {
      const reply = await request((id) => ({ almadarChannel: "register", id, schemaName: schema.name }));
      const held = reply.almadarChannel === "registered" && reply.held;
      return { success: held, carriesCircuitState: false };
    },
    async unregister() {
      pending.clear();
    },
    async send(orbitalName, req) {
      const reply = await request((id) => ({ almadarChannel: "send", id, orbitalName, request: req }));
      if (reply.almadarChannel !== "reply") {
        return { success: false, transitioned: false, states: {}, emittedEvents: [], error: "The host answered out of protocol" };
      }
      return reply.response;
    },
    subscribe(onPush) {
      return channel.onMessage((message) => {
        if (message.almadarChannel === "push") onPush(message.emitted, message.target);
      });
    },
    subscribeHostDispatches(onDispatch) {
      return channel.onMessage((message) => {
        if (message.almadarChannel === "dispatched") onDispatch(message.orbitalName, message.request, message.response);
      });
    }
  };
}
function serveChannel(channel, transport, options) {
  const stop = channel.onMessage((message) => {
    if (message.almadarChannel === "register") {
      channel.post({ almadarChannel: "registered", id: message.id, held: message.schemaName === options.schemaName });
      return;
    }
    if (message.almadarChannel !== "send") return;
    transport.send(message.orbitalName, message.request).then(
      (response) => channel.post({ almadarChannel: "reply", id: message.id, response }),
      (err) => channel.post({
        almadarChannel: "reply",
        id: message.id,
        response: { success: false, transitioned: false, states: {}, emittedEvents: [], error: err.message }
      })
    );
  });
  return {
    push: (emitted, target) => channel.post({ almadarChannel: "push", emitted, target }),
    pushDispatch: (orbitalName, request, response) => channel.post({ almadarChannel: "dispatched", orbitalName, request, response }),
    stop
  };
}
function holdUntilServed(channel) {
  let held = [];
  const listeners = [];
  channel.onMessage((message) => {
    if (held !== void 0) held.push(message);
    else listeners.forEach((l) => l(message));
  });
  return {
    post: (message) => channel.post(message),
    onMessage(listener) {
      listeners.push(listener);
      if (held !== void 0) {
        const early = held;
        held = void 0;
        early.forEach((m) => listeners.forEach((l) => l(m)));
      }
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    ...channel.onClose !== void 0 ? { onClose: channel.onClose.bind(channel) } : {}
  };
}

export { createChannelTransport, holdUntilServed, serveChannel };
