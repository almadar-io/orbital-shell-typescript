import type { OrbitalSchema, UserContext } from '@almadar/core';
import { createInProcessTransport, type EventTransport } from '@almadar/shell-runtime';
import { nativeMemoryPersistence, openLocalKernel } from '../runtime/index.js';
import { evaluateOnKernel, type KernelEngine } from '@almadar/shell-runtime';
import { loadTestKernel } from './kernel-engine.js';

/**
 * The hosted playground's stateless topology: the program is registered once, and every request runs on a fresh
 * session of it (`KernelEngine.fork`) over the kernel's own memory store, the client carrying the circuit state on the leg.
 */
export function statelessKernelTransport(
  schema: OrbitalSchema,
  user: () => Promise<UserContext | undefined> = async () => undefined,
): EventTransport {
  let template: Promise<KernelEngine> | undefined;
  return createInProcessTransport(async (orbital, request) => {
    const viewer = await user();
    template ??= loadTestKernel().then((kernel) => openLocalKernel({ kernel, schema, persistence: nativeMemoryPersistence(kernel) }));
    const engine = (await template).fork();
    try {
      return await evaluateOnKernel({ engine, orbital }, request, viewer, request.locale);
    } finally {
      engine.dispose();
    }
  }, { carriesCircuitState: true });
}
