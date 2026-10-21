/**
 * useClientTicks — runs the kernel's tick clock for a circuit.
 *
 * The kernel decides which declared ticks are due and runs them (`KernelClient.startFrames`, one host frame per
 * scheduled frame, paused while the document is hidden); this hook only starts and stops that clock and hands each
 * frame's outcomes to the painter.
 *
 * @packageDocumentation
 */
import { createContext, useContext, useEffect } from 'react';
import type { ClientKernelOutcome } from '../../index';
import type { KernelClient } from '../../lib/kernel-client';
import type { FrameScheduler } from '../../lib/kernel-frames';

export interface UseClientTicksOptions {
  /** The kernel client whose tick clock runs. */
  kernelClient: KernelClient;
  /** Paints one kernel frame's outcomes. */
  onKernelFrame: (outcomes: ClientKernelOutcome[]) => void;
  scheduleFrame?: FrameScheduler;
  /** The host runs the whole program (an extension's worker), ticks included: this view runs none. */
  hostRunsProgram?: boolean;
}

/** True while a host holds its preview paused (`OrbPreview paused`): the circuits under it run no tick. */
export const ClientTicksPausedContext = createContext(false);

export function useClientTicks(options: UseClientTicksOptions): void {
  const { kernelClient, onKernelFrame, scheduleFrame, hostRunsProgram } = options;
  const paused = useContext(ClientTicksPausedContext);
  useEffect(() => {
    if (hostRunsProgram === true || paused) return;
    return kernelClient.startFrames(onKernelFrame, scheduleFrame);
  }, [kernelClient, onKernelFrame, scheduleFrame, hostRunsProgram, paused]);
}
