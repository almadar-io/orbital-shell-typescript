import { parseCron, cronMinuteKey, cronMatches } from './chunk-CROS2GEX.js';

// src/runtime/time/TickScheduler.ts
var EVERY_PASS = 0;
var CRON_CHECK_INTERVAL_MS = 1e3;
var TickScheduler = class {
  ticks = /* @__PURE__ */ new Map();
  nextId = 1;
  running = false;
  paused = false;
  frameHandle = null;
  hasRaf;
  constructor() {
    this.hasRaf = typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  }
  /**
   * Register a tick. `intervalMs <= 0` means "every pass" (a frame-interval
   * tick, matching LOLO's `interval: "frame"`). Returns a handle to stop
   * just this tick.
   */
  add(intervalMs, onDue) {
    const id = this.nextId++;
    this.ticks.set(id, {
      kind: "interval",
      intervalMs: intervalMs > 0 ? intervalMs : EVERY_PASS,
      accumulatedMs: 0,
      lastTimestamp: null,
      onDue
    });
    this.ensureRunning();
    return {
      stop: () => {
        this.ticks.delete(id);
        this.maybeStop();
      }
    };
  }
  /**
   * Register a cron-scheduled tick (`ticks { ... every "0 9 * * *" }`).
   * Fires at most once per matching calendar minute. Throws if `expression` isn't a valid 5-field cron
   * string; callers on a path the compiler has already validated (e.g.
   * generated code) won't hit this, but a raw runtime value might.
   */
  addCron(expression, onDue) {
    const fields = parseCron(expression);
    const id = this.nextId++;
    this.ticks.set(id, {
      kind: "cron",
      fields,
      accumulatedMs: CRON_CHECK_INTERVAL_MS,
      // check on the first pass, not after a full second
      lastTimestamp: null,
      lastFiredMinuteKey: -1,
      onDue
    });
    this.ensureRunning();
    return {
      stop: () => {
        this.ticks.delete(id);
        this.maybeStop();
      }
    };
  }
  /** Stop every tick and the shared loop. */
  stopAll() {
    this.ticks.clear();
    this.maybeStop();
  }
  /** True while the scheduler is paused (no tick callback fires and no backlog accumulates). */
  get isPaused() {
    return this.paused;
  }
  /**
   * Halt the shared loop without dropping registered ticks. No `onDue`
   * fires again until `resume()`. A no-op if already paused.
   */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.stopLoop();
  }
  /**
   * Restart the shared loop after `pause()`. Every registered tick's phase
   * is reset (`lastTimestamp = null`) so the paused duration is never
   * counted as elapsed time — the same "first pass just captures the
   * timestamp" behavior a freshly `add()`-ed tick gets, which is what keeps
   * resume from bursting a backlog of missed beats. A no-op if not paused.
   */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const tick of this.ticks.values()) {
      tick.lastTimestamp = null;
    }
    if (this.ticks.size > 0) {
      this.ensureRunning();
    }
  }
  ensureRunning() {
    if (this.running || this.paused) return;
    this.running = true;
    if (this.hasRaf) {
      const loop = (timestamp) => {
        if (!this.running) return;
        this.advance(timestamp);
        this.frameHandle = requestAnimationFrame(loop);
      };
      this.frameHandle = requestAnimationFrame(loop);
    } else {
      this.frameHandle = setInterval(() => this.advance(Date.now()), 16);
    }
  }
  maybeStop() {
    if (this.ticks.size > 0 || !this.running) return;
    this.stopLoop();
  }
  /** Cancel the active rAF/interval loop, if any, and clear the running flag. */
  stopLoop() {
    this.running = false;
    if (this.frameHandle !== null) {
      if (this.hasRaf) {
        cancelAnimationFrame(this.frameHandle);
      } else {
        clearInterval(this.frameHandle);
      }
      this.frameHandle = null;
    }
  }
  advance(timestamp) {
    for (const tick of this.ticks.values()) {
      if (tick.kind === "cron") {
        this.advanceCron(tick, timestamp);
        continue;
      }
      if (tick.intervalMs <= EVERY_PASS) {
        tick.onDue();
        continue;
      }
      if (tick.lastTimestamp === null) {
        tick.lastTimestamp = timestamp;
        continue;
      }
      tick.accumulatedMs += timestamp - tick.lastTimestamp;
      tick.lastTimestamp = timestamp;
      if (tick.accumulatedMs >= tick.intervalMs) {
        tick.onDue();
        tick.accumulatedMs = tick.accumulatedMs % tick.intervalMs;
      }
    }
  }
  /** Cron ticks check calendar-match at most once a second, deduped per matching minute. */
  advanceCron(tick, timestamp) {
    if (tick.lastTimestamp === null) {
      tick.lastTimestamp = timestamp;
      return;
    }
    tick.accumulatedMs += timestamp - tick.lastTimestamp;
    tick.lastTimestamp = timestamp;
    if (tick.accumulatedMs < CRON_CHECK_INTERVAL_MS) return;
    tick.accumulatedMs = 0;
    const now = /* @__PURE__ */ new Date();
    const minuteKey = cronMinuteKey(now);
    if (minuteKey !== tick.lastFiredMinuteKey && cronMatches(tick.fields, now)) {
      tick.lastFiredMinuteKey = minuteKey;
      tick.onDue();
    }
  }
};
function createTickScheduler() {
  return new TickScheduler();
}

export { TickScheduler, createTickScheduler };
