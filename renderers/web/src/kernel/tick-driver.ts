/**
 * Poll-mode tick driver for a browser host: every animation frame runs `Kernel.frame(now)`, then applies the
 * `FrameWire`. A frame still pending (folding) skips the next animation frame, so a slow fold never stacks
 * frames; the kernel drops missed beats. The kernel orders what a frame's dispatches owe the host (EXEC-CONC-8). A hidden page pauses the kernel's clock and stops polling.
 */
import type { LocalFoldKernel } from '@almadar/shell-runtime/client/client-kernel';
import { applyFrame, type FrameApplied, type FramePostPort } from '@almadar/shell-runtime/kernel/frame-applier';

export interface TickKernelPort {
  frame(nowMs: number): string | undefined;
  framePause(): void;
  frameResume(): void;
  tickCount(): number;
}

export interface VisibilityPort {
  hidden(): boolean;
  onChange(listener: () => void): () => void;
}

export interface TickFramePorts {
  kernel: TickKernelPort;
  client: LocalFoldKernel;
  /** Posts what fired ticks owe; `undefined` for a host with no transport (the frame then only folds locally). */
  post: FramePostPort | undefined;
}

/** One host frame: `Kernel.frame(now())`, then the applier. Shared by the poll driver and by hosts that step on demand. */
export function runTickFrame(ports: TickFramePorts, now: () => number): Promise<FrameApplied> {
  return applyFrame(ports.kernel.frame(now()), ports.client, ports.post);
}

export interface TickDriverPorts extends TickFramePorts {
  now(): number;
  requestFrame(callback: (timestampMs: number) => void): number;
  cancelFrame(handle: number): void;
  visibility: VisibilityPort;
  onApplied?(applied: FrameApplied): void;
  onError?(error: Error): void;
}

export interface TickDriver {
  /** Starts polling when the kernel has ticks and the page is visible; a no-op otherwise. Call again after ticks mount. */
  start(): void;
  stop(): void;
}

export function createTickDriver(ports: TickDriverPorts): TickDriver {
  let handle: number | undefined;
  let pending = false;
  let stopped = true;
  let unsubscribe: (() => void) | undefined;

  const disarm = (): void => {
    if (handle !== undefined) ports.cancelFrame(handle);
    handle = undefined;
  };

  const arm = (): void => {
    if (stopped || handle !== undefined || ports.visibility.hidden()) return;
    handle = ports.requestFrame(onFrame);
  };

  const runFrame = async (): Promise<void> => {
    const applied = await runTickFrame(ports, ports.now);
    if (applied.fired.length > 0 || applied.errors.length > 0) ports.onApplied?.(applied);
  };

  function onFrame(): void {
    handle = undefined;
    if (stopped) return;
    if (ports.kernel.tickCount() === 0) {
      stopped = true;
      unsubscribe?.();
      unsubscribe = undefined;
      return;
    }
    arm();
    if (pending) return;
    pending = true;
    runFrame().catch((error: Error) => ports.onError?.(error)).finally(() => { pending = false; });
  }

  const onVisibility = (): void => {
    if (stopped) return;
    if (ports.visibility.hidden()) {
      ports.kernel.framePause();
      disarm();
    } else {
      ports.kernel.frameResume();
      arm();
    }
  };

  return {
    start() {
      if (!stopped || ports.kernel.tickCount() === 0) return;
      stopped = false;
      unsubscribe = ports.visibility.onChange(onVisibility);
      if (ports.visibility.hidden()) ports.kernel.framePause();
      arm();
    },
    stop() {
      stopped = true;
      disarm();
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
