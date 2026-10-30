export type {
  RuntimeEvent,
  EventListener,
  Unsubscribe,
  IEventBus,
  EffectHandlers,
  BindingContext,
  Effect,
  EffectResult,
  EvaluationContextExtensions,
  EntityRow,
  EventPayload,
} from '@almadar/shell-runtime/runtime/types';

export { eventRouteKey } from '@almadar/shell-runtime/runtime/events/identity/routing';



export { nativeMemoryPersistence } from './evaluation/native-memory.js';
export { createLocalStoreTransport, localStorePersistence, openLocalKernel, resolveLocalRows, type LocalKernelOptions } from './evaluation/local-store-transport.js';
export type { LocalStoreTransportOptions } from './evaluation/local-store-transport.js';
export { createResidenceTransport } from '@almadar/shell-runtime/runtime/evaluation/residence-transport';
export type { ResidenceTransportOptions } from '@almadar/shell-runtime/runtime/evaluation/residence-transport';
export { browserStoreName, openBrowserHost, openBrowserStore, openBrowserStoreTransport, openBundledBrowserStore } from './evaluation/browser-store-transport.js';
export type { BrowserHost, BrowserHostOptions, BrowserStoreTransportOptions, InputDispatchListener } from './evaluation/browser-store-transport.js';

export * from './ui/index.js';
