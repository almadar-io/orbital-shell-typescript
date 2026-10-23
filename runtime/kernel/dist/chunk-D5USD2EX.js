import { createHttpTransport } from './chunk-QELZ6TEJ.js';
import { createLogger } from '@almadar/logger';

var log = createLogger("almadar:runtime:server-bridge");
var ServerBridge = class {
  config;
  state = {
    connected: false,
    eventsForwarded: 0,
    eventsReceived: 0
  };
  unsubscribes = [];
  pollTimer;
  ws;
  fetchFn;
  /** The one HTTP request/response leg — shared with `@almadar/ui`'s transport (P5, EventTransport.ts). */
  transport;
  constructor(config) {
    this.config = {
      pollInterval: 5e3,
      ...config
    };
    this.fetchFn = config.fetch || fetch.bind(globalThis);
    this.transport = createHttpTransport({ serverUrl: config.serverUrl, fetch: this.fetchFn });
  }
  // ==========================================================================
  // Connection Management
  // ==========================================================================
  /**
   * Connect the bridge - start forwarding events
   */
  connect() {
    if (this.state.connected) {
      this.log("warn", "Already connected");
      return;
    }
    this.log("info", "Connecting bridge...");
    this.setupEventForwarding();
    if (this.config.useWebSocket) {
      this.setupWebSocket();
    } else if (this.config.pollInterval && this.config.pollInterval > 0) {
      this.setupPolling();
    }
    this.state.connected = true;
    this.log("info", "Bridge connected");
  }
  /**
   * Disconnect the bridge
   */
  disconnect() {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = void 0;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = void 0;
    }
    this.state.connected = false;
    this.log("info", "Bridge disconnected");
  }
  /**
   * Get current bridge state
   */
  getState() {
    return { ...this.state };
  }
  // ==========================================================================
  // Event Forwarding (Client -> Server)
  // ==========================================================================
  setupEventForwarding() {
    const { eventBus, forwardEvents, forwardPattern } = this.config;
    if (forwardEvents && forwardEvents.length > 0) {
      for (const eventType of forwardEvents) {
        const unsub = eventBus.on(eventType, (event) => {
          this.forwardToServer(event);
        });
        this.unsubscribes.push(unsub);
      }
    } else if (forwardPattern) {
      if (forwardPattern === "*") {
        const unsub = eventBus.on("*", (event) => {
          if (!event.type.startsWith("UI:") && !event.type.startsWith("BRIDGE:")) {
            this.forwardToServer(event);
          }
        });
        this.unsubscribes.push(unsub);
      } else {
        const prefix = forwardPattern.replace("*", "");
        const unsub = eventBus.on("*", (event) => {
          if (event.type.startsWith(prefix)) {
            this.forwardToServer(event);
          }
        });
        this.unsubscribes.push(unsub);
      }
    }
  }
  async forwardToServer(event) {
    const { serverUrl, targetOrbital } = this.config;
    try {
      if (targetOrbital && targetOrbital !== "broadcast") {
        await this.sendEventToOrbital(targetOrbital, event);
      } else {
        const orbitals = await this.fetchOrbitals();
        for (const orbital of orbitals) {
          await this.sendEventToOrbital(orbital.name, event);
        }
      }
      this.state.eventsForwarded++;
      this.log("debug", `Forwarded event: ${event.type}`);
    } catch (error) {
      this.state.lastError = String(error);
      this.log("error", `Failed to forward event: ${event.type}`, error instanceof Error ? error : String(error));
    }
  }
  async sendEventToOrbital(orbitalName, event) {
    const request = { event: event.type, payload: event.payload };
    const result = await this.transport.send(orbitalName, request);
    if (result.emittedEvents && result.emittedEvents.length > 0) {
      for (const emitted of result.emittedEvents) {
        this.config.eventBus.emit(`SERVER:${emitted.event}`, emitted.payload);
        this.state.eventsReceived++;
      }
    }
  }
  async fetchOrbitals() {
    const response = await this.fetchFn(this.config.serverUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch orbitals: ${response.status}`);
    }
    const data = await response.json();
    return data.orbitals || [];
  }
  // ==========================================================================
  // Server -> Client (Polling)
  // ==========================================================================
  setupPolling() {
    this.log("debug", "Polling mode - events received via forward response");
  }
  // ==========================================================================
  // Server -> Client (WebSocket)
  // ==========================================================================
  setupWebSocket() {
    const { serverUrl } = this.config;
    const wsUrl = serverUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/api\/orbitals$/, "/ws/orbitals");
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => {
        this.log("info", "WebSocket connected");
      };
      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "event") {
            this.config.eventBus.emit(`SERVER:${data.event}`, data.payload);
            this.state.eventsReceived++;
            this.log("debug", `Received server event: ${data.event}`);
          }
        } catch (error) {
          this.log("error", "Failed to parse WebSocket message", error instanceof Error ? error : String(error));
        }
      };
      this.ws.onerror = (error) => {
        this.state.lastError = "WebSocket error";
        this.log("error", "WebSocket error", error);
      };
      this.ws.onclose = () => {
        this.log("info", "WebSocket closed");
      };
    } catch (error) {
      this.log("error", "Failed to create WebSocket", error instanceof Error ? error : String(error));
    }
  }
  // ==========================================================================
  // Direct Methods
  // ==========================================================================
  /**
   * Send an event directly to a specific orbital (bypassing EventBus)
   */
  async sendEvent(orbitalName, event, payload) {
    try {
      const result = await this.transport.send(orbitalName, { event, payload });
      return {
        success: result.success,
        states: result.states,
        emittedEvents: result.emittedEvents,
        error: result.error
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Get current state of an orbital's traits
   */
  async getOrbitalState(orbitalName) {
    const { serverUrl } = this.config;
    const url = `${serverUrl}/${orbitalName}`;
    try {
      const response = await this.fetchFn(url);
      const data = await response.json();
      if (data.success && data.orbital) {
        const states = {};
        for (const trait of data.orbital.traits) {
          states[trait.name] = trait.currentState;
        }
        return { success: true, states };
      }
      return { success: false, error: data.error };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  // ==========================================================================
  // Utilities
  // ==========================================================================
  log(level, message, data) {
    if (!this.config.debug && level === "debug") return;
    const meta = data === void 0 ? {} : data instanceof Error ? { error: data } : { detail: typeof data === "string" ? data : JSON.stringify(data) };
    log[level](message, meta);
  }
};
function createServerBridge(config) {
  return new ServerBridge(config);
}

export { ServerBridge, createServerBridge };
