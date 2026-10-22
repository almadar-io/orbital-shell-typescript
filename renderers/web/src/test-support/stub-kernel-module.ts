import type { KernelModule, KernelServerClass } from '../kernel/wire.js';

/**
 * A whole `KernelModule` around a scripted `Server`, for tests that drive the engine without the wasm. Every member a
 * test does not name throws when called, so a double never falls behind the module's surface.
 */
export function stubKernelModule(Server: KernelServerClass, overrides: Partial<Omit<KernelModule, 'Server'>> = {}): KernelModule {
  const unexpected = (name: string) => (): never => {
    throw new Error(`stub kernel module: ${name} was not expected`);
  };
  return {
    Server,
    osGlobMatches: () => false,
    isPublicAddress: () => false,
    osDeferringOps: () => '[]',
    osCompletionEvent: () => 'null',
    substrateCompletionEvent: () => 'null',
    tabUrlMatches: () => false,
    installLanguage: unexpected('installLanguage'),
    evaluateMany: unexpected('evaluateMany'),
    resolveValues: unexpected('resolveValues'),
    evaluateGuards: unexpected('evaluateGuards'),
    evaluateTraced: unexpected('evaluateTraced'),
    traceEffects: unexpected('traceEffects'),
    mapListenPayload: unexpected('mapListenPayload'),
    scopeRows: unexpected('scopeRows'),
    checkMutationAccess: unexpected('checkMutationAccess'),
    resolveRowBinding: unexpected('resolveRowBinding'),
    ...overrides,
  };
}
