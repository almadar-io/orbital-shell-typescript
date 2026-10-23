// src/effects/in-flight-calls.ts
var InFlightCalls = class {
  calls = /* @__PURE__ */ new Map();
  /** Whether a call started with `key` is still running. */
  inFlight(key) {
    return (this.calls.get(key)?.size ?? 0) > 0;
  }
  /**
   * Run `work` registered under `key`, handing it the abort signal; `work` must settle promptly once the
   * signal aborts (see `untilAborted`). The call is cancelled when the signal was aborted by the time
   * `work` settles, whatever it settled with.
   */
  async run(key, work) {
    const lease = this.track(key);
    try {
      const value = await work(lease.signal);
      return lease.signal.aborted ? { cancelled: true } : { cancelled: false, value };
    } catch (err) {
      if (lease.signal.aborted) return { cancelled: true };
      throw err;
    } finally {
      lease.release();
    }
  }
  reserve(key) {
    return this.inFlight(key) ? void 0 : this.track(key);
  }
  track(key) {
    const controller = new AbortController();
    const running = this.calls.get(key) ?? /* @__PURE__ */ new Set();
    running.add(controller);
    this.calls.set(key, running);
    return {
      signal: controller.signal,
      release: () => {
        running.delete(controller);
        if (running.size === 0 && this.calls.get(key) === running) this.calls.delete(key);
      }
    };
  }
  cancelAll() {
    for (const key of this.calls.keys()) this.cancel(key);
  }
  /** Abort every call running under `key`; false (a no-op) when none is. */
  cancel(key) {
    const running = this.calls.get(key);
    if (running === void 0 || running.size === 0) return false;
    this.calls.delete(key);
    for (const controller of running) controller.abort();
    return true;
  }
};
function untilAborted(signal, promise) {
  if (signal.aborted) {
    promise.catch(() => void 0);
    return Promise.reject(new Error("The call was cancelled"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("The call was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

export { InFlightCalls, untilAborted };
