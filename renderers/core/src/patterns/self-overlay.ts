/**
 * Pattern types that paint their own backdrop/chrome (single owner — UI slot
 * layer and wiring lint both consult this instead of growing a private list).
 * Everything else rendered into a `modal`/`drawer` slot gets the slot shell,
 * whose close control (X / Escape / overlay-click) emits `CLOSE`/`CANCEL`.
 */
export const SELF_OVERLAY_PATTERN_TYPES: ReadonlySet<string> = new Set(['modal', 'confirm-dialog']);
