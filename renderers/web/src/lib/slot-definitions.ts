/**
 * Slot Definitions
 *
 * Defines the available UI slots and their rendering behavior.
 * Slots are either inline (rendered in the component tree) or
 * portal (rendered to document.body via React Portal).
 *
 * @packageDocumentation
 */

import type { UISlot, SlotDefinition, SlotType } from '../types/renderer-types';

// ============================================================================
// Slot Definitions
// ============================================================================

/**
 * Definitions for all available UI slots.
 *
 * Inline slots render within the component hierarchy.
 * Portal slots render to document.body, breaking out of overflow containers.
 */
export const SLOT_DEFINITIONS: Partial<Record<UISlot, SlotDefinition>> & Record<'main' | 'sidebar' | 'dock' | 'modal' | 'drawer' | 'overlay' | 'center' | 'toast' | 'hud-top' | 'hud-bottom' | 'floating', SlotDefinition> = {
  // -------------------------------------------------------------------------
  // Inline Slots - Render in place within the component tree
  // -------------------------------------------------------------------------

  main: {
    name: 'main',
    type: 'inline',
  },

  sidebar: {
    name: 'sidebar',
    type: 'inline',
  },

  dock: {
    name: 'dock',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 850,
  },

  // -------------------------------------------------------------------------
  // Portal Slots - Render to document.body via React Portal
  // -------------------------------------------------------------------------

  modal: {
    name: 'modal',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 1000,
  },

  drawer: {
    name: 'drawer',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 900,
  },

  overlay: {
    name: 'overlay',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 1100,
  },

  center: {
    name: 'center',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 1000,
  },

  toast: {
    name: 'toast',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 1200,
    notification: true,
  },

  // -------------------------------------------------------------------------
  // Game HUD Slots - Portal for game overlay UI
  // -------------------------------------------------------------------------

  'hud-top': {
    name: 'hud-top',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 500,
  },

  'hud-bottom': {
    name: 'hud-bottom',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 500,
  },

  floating: {
    name: 'floating',
    type: 'portal',
    portalTarget: 'body',
    zIndex: 800,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the slot definition for a slot name.
 */
export function getSlotDefinition(slot: UISlot): SlotDefinition | undefined {
  return SLOT_DEFINITIONS[slot];
}

/**
 * Check if a slot is a portal slot.
 */
export function isPortalSlot(slot: string): boolean {
  return SLOT_DEFINITIONS[slot as UISlot]?.type === 'portal';
}

/**
 * A notification slot (toast): an embedded trait's render there escapes its
 * host frame; any other slot's render of an embedded trait is frame content.
 */
export function isNotificationSlot(slot: string): boolean {
  return SLOT_DEFINITIONS[slot as UISlot]?.notification === true;
}

/**
 * Get all slots of a specific type.
 */
function getSlotsByType(type: SlotType): UISlot[] {
  return Object.entries(SLOT_DEFINITIONS)
    .filter(([, def]) => def?.type === type)
    .map(([name]) => name as UISlot);
}

/**
 * Get all inline slots.
 */
export function getInlineSlots(): UISlot[] {
  return getSlotsByType('inline');
}

/**
 * All valid slot names.
 */
export const ALL_SLOTS: UISlot[] = Object.keys(SLOT_DEFINITIONS) as UISlot[];
