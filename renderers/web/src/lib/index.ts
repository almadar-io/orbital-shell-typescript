/**
 * Lib - Utility functions and registries
 *
 * Core utilities for the Almadar UI library.
 */

// Class name utility


// API client
export * from './api-client';

// Debug utilities (debug.ts has main debug functions)
export * from './debug';

// Debug utils (exclude isDebugEnabled which is in debug.ts)
export {
  setDebugEnabled,
  toggleDebug,
  onDebugToggle,
  initDebugShortcut,
} from './debugUtils';

export * from './entityDebug';
export * from './debugRegistry';

// Trait registries
export * from './guardRegistry';
export * from './tickRegistry';
export * from './traitRegistry';

// Transport discipline (T7/T8) — consumed by the interpreted ServerBridge and
// the compiled TS shell's generated hooks alike (single owner, no dupe).
export * from './command-send-pump';

// Perf instrumentation (runtime-path hot spots) — the React-facing layer over
// @almadar/runtime/ui's framework-free ring + aggregation
export * from './perf';

// Verification
export * from './verificationRegistry';

// Data utilities


export * from './getNestedValue';

// Keyboard input layer (device keycode → semantic event, shared by every keyMap consumer)
export * from './keyMapEvent';

// Visualizer

// Content parsing
export * from './parseContentSegments';
export { parseLessonSegments } from './parseLessonSegments';
export type { LessonSegment } from './parseLessonSegments';

// Al-Jazari state-machine diagram layout (framework-free — server-side SVG renderers use this)
export * from './jazari';

// Pure vim-flavored editor motions (CodeBlock consumes these — no DOM here)
export * from './editorMotions';

// Theme tokens → CSS custom-property mapping (forward direction) + the
// per-axis var tables it shares with @almadar/core's one-time CSS→JSON
// theme migration script (the inverse direction) — single source of the
// var-name mapping, read both ways.
export * from './themeTokens';

// Lucide canonical name → SF Symbol / Material Symbol (native shells icon path) —
// consumed by pattern-sync's `icon-map` command to emit IconMap.swift/IconMap.kt.
export * from './iconNativeMap';
export { computeLineDiff, type LineDiffLine } from './lineDiff';
export { enterClassName, asEnterAnimation, ENTER_SLOT_CLASS, MAX_ENTER_DELAY } from './enter';
