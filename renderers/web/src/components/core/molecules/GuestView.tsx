/**
 * GuestView — paints the UI of a guest program session (program/open) inside the opener's view.
 * Paint only: a click on a control inside it is routed by the kernel to the opener as its
 * `deliver` event { guest, address, event, payload }.
 */
import React from 'react';
import type { EventKey } from '@almadar/core';
import { Box } from '../../../core';

export interface GuestViewProps {
  /** Guest session handle (`program/open` answers it, e.g. "guest-1"). Data for the kernel; never rendered. */
  guest: string;
  /** Guest trait that painted this content (`rendered[].trait`); the kernel delivers a click as address `<source>.<EVENT>`. Data for the kernel; never rendered. */
  source: string;
  /** The opener trait's declared event a click inside this view is delivered as. The kernel emits it, never the renderer. */
  deliver: EventKey;
  /** The guest's painted content */
  children?: React.ReactNode;
}

/**
 * GuestView - Paints a guest program's UI; guest, source and deliver are kernel routing data
 */
export const GuestView: React.FC<GuestViewProps> = ({ children }) => (
  <Box fullWidth fullHeight>{children}</Box>
);

GuestView.displayName = 'GuestView';

export default GuestView;
