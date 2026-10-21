'use client';
/**
 * RenderSlotContext — which UI slot the current subtree is rendering into.
 *
 * Default is 'main': a compiled app's page body renders patterns directly
 * (no UISlotRenderer), so the absence of a provider IS the main slot. The
 * exceptional hosts declare themselves: the runtime path's UISlotComponent
 * provides its slot name per subtree; the compiled path's ModalSlot /
 * DrawerSlot provide 'modal' / 'drawer'.
 *
 * Consumers gate slot-sensitive behavior on it — e.g. DetailPanel only
 * feeds the loaded record's title into the nav-stack crumb from the routed
 * 'main' slot (a modal or drawer must not relabel the page's crumb).
 */

import React, { createContext, useContext } from 'react';

const RenderSlotContext = createContext<string>('main');

export interface RenderSlotProviderProps {
  slot: string;
  children: React.ReactNode;
}

export const RenderSlotProvider: React.FC<RenderSlotProviderProps> = ({ slot, children }) => (
  <RenderSlotContext.Provider value={slot}>{children}</RenderSlotContext.Provider>
);

RenderSlotProvider.displayName = 'RenderSlotProvider';

/** The slot name the calling component is rendering inside ('main' by default). */
export function useRenderSlot(): string {
  return useContext(RenderSlotContext);
}
