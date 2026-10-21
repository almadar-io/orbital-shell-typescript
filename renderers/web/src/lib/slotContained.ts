'use client';
import { createContext } from 'react';

/**
 * When true, portal-slot content and self-portaling overlay organisms render
 * inline with absolute positioning inside the UISlotRenderer's bounds instead
 * of portaling to the global `#ui-slot-portal-root` with fixed positioning.
 * Set by UISlotRenderer's contained mode (hudMode="inline"), used by
 * playground/builder previews. Lives in lib (no component imports) so any
 * component can consume it without an import cycle.
 */
export const SlotContainedContext = createContext<boolean>(false);
