/**
 * GuestView — paints the UI of a guest program session (program/open) inside the opener's view.
 * Paint only: a click on a control inside it is routed by the kernel to the opener as its
 * `deliver` event { guest, address, event, payload }.
 *
 * The guest's own traits are the ones an `@trait.X` inside its paint names, so the view holds a scoped
 * UISlotProvider seeded with every paint the guest made: `TraitFrame` resolves against the guest, not the host.
 */
import React, { useLayoutEffect, useRef } from 'react';
import type { EventKey, PatternNode } from '@almadar/core';
import { Box } from '../../../core';
import { UISlotProvider, useUISlots } from '../../../providers/UISlotContext';
import type { SlotProps } from '../../../providers/UISlotContext';
import { convertFnFormLambdasInProps } from '../../../lib/fn-form-lambda';
import { unwrapPattern } from '../../../hooks/circuit/useSlotFlush';

export interface GuestPaintEntry {
  /** Slot the guest trait painted */
  slot: string;
  /** Guest trait that painted `content` */
  trait: string;
  /** Whether the trait is embedded (`@trait.X`) on the guest's page rather than the page root */
  embedded: boolean;
  /** The painted pattern tree */
  content: PatternNode | string | null;
}

export interface GuestViewProps {
  /** Guest session handle (`program/open` answers it, e.g. "guest-1"). Data for the kernel; never rendered. */
  guest: string;
  /** Guest trait that painted this content (`rendered[].trait`); the kernel delivers a click as address `<source>.<EVENT>`. Data for the kernel; never rendered. */
  source: string;
  /** The opener trait's declared event a click inside this view is delivered as. The kernel emits it, never the renderer. */
  deliver: EventKey;
  /** Every paint the guest made (`rendered` entries, the latest per trait and slot). An `@trait.X` inside the content resolves to the guest's trait X from these. */
  paints?: ReadonlyArray<GuestPaintEntry>;
  /** The guest's painted content */
  children?: React.ReactNode;
}

function SeedGuestPaints({ paints }: { paints: ReadonlyArray<GuestPaintEntry> }): null {
  const slots = useUISlots();
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  useLayoutEffect(() => {
    for (const paint of paints) {
      if (paint.content === null) continue;
      const { bareTraitRef, patternType, props } = unwrapPattern(paint.content);
      const propsValue: SlotProps | string = bareTraitRef !== undefined ? bareTraitRef : { ...(props ?? {}) };
      slotsRef.current.updateTraitContent(paint.trait, {
        pattern: patternType as string,
        props: convertFnFormLambdasInProps(propsValue, typeof patternType === 'string' ? patternType : undefined),
        slot: paint.slot,
        priority: 0,
      });
    }
  }, [paints]);
  return null;
}

/**
 * GuestView - Paints a guest program's UI; guest, source and deliver are kernel routing data
 */
export const GuestView: React.FC<GuestViewProps> = ({ paints, children }) => (
  <UISlotProvider>
    {paints !== undefined && <SeedGuestPaints paints={paints} />}
    <Box fullWidth fullHeight>{children}</Box>
  </UISlotProvider>
);

GuestView.displayName = 'GuestView';

export default GuestView;
