export * from './core/atoms';
export * from './core/molecules';
export * from './core/organisms';
export * from './core/templates';

// The drawable render-ui patterns (R3F-free) — part of the pattern import surface.
export * from './game/patterns';

// Utility re-exports (so clients can use `import { cn } from './index'`)


// Hook re-exports (so clients can use `import { useEventBus } from './index'`)
export * from '../hooks';

// Slot-host manifest types (package root, alongside the types barrel at
// `../types/index`) — SlotHostRegion/SlotHostManifest/assertUniqueSlotsPerHost
export * from '../types/slot-host';
