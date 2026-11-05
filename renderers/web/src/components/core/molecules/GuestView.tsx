/**
 * GuestView — paints the UI of a guest program session (program/open) inside the opener's view.
 * Paint only: a click on a control inside it is routed by the kernel to the opener as its
 * `deliver` event { guest, address, event, payload }.
 *
 * The guest's own traits are the ones an `@trait.X` inside its paint names, so the view holds a scoped
 * UISlotProvider seeded with every paint the guest made: `TraitFrame` resolves against the guest, not the host.
 * Every slot the guest paints renders inside the view (contained, never the host page's), and an in-app link
 * inside it is the guest's navigation, emitted as `navigate`, never the host router's.
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useInRouterContext } from 'react-router-dom';
import type { EventKey, PatternNode, UISlot } from '@almadar/core';
import { Box, useEventBus } from '../../../core';
import { UISlotProvider, useUISlots } from '../../../providers/UISlotContext';
import { UISlotRenderer } from '../organisms/UISlotRenderer';
import { HostHrefBaseProbe, useInAppLinkInterceptor } from '../../../lib/inAppLinks';
import { CurrentPagePathProvider } from '../../../providers/CurrentPagePathContext';
import type { SlotProps } from '../../../providers/UISlotContext';
import { convertFnFormLambdasInProps } from '../../../lib/fn-form-lambda';
import { unwrapPattern } from '../../../hooks/circuit/useSlotFlush';

export interface GuestPaintEntry {
  /** Slot the guest trait painted */
  slot: UISlot;
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
  /** The opener trait's declared event an in-app link inside this view is emitted as, with { guest, route }. Without it a link inside the guest does nothing. */
  navigate?: EventKey;
  /** The guest's current route (`program/open` and `program/navigate` answer it): the current page path of everything inside, so the guest's navigation shows its own active page and closes its own drawers. */
  route?: string;
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
      if (paint.content === null) {
        slotsRef.current.clearBySource(paint.slot, paint.trait);
        continue;
      }
      const { bareTraitRef, patternType, props } = unwrapPattern(paint.content);
      const propsValue: SlotProps | string = bareTraitRef !== undefined ? bareTraitRef : { ...(props ?? {}) };
      const pattern = patternType as string;
      const converted = convertFnFormLambdasInProps(propsValue, typeof patternType === 'string' ? patternType : undefined);
      // An embedded trait shows only where an `@trait.X` names it; a page-root paint owns its slot.
      if (paint.embedded) {
        slotsRef.current.updateTraitContent(paint.trait, { pattern, props: converted, slot: paint.slot, priority: 0 });
      } else {
        slotsRef.current.render({ target: paint.slot, pattern, props: converted, sourceTrait: paint.trait });
      }
    }
  }, [paints]);
  return null;
}

/**
 * GuestView - Paints a guest program's UI; guest, source and deliver are kernel routing data
 */
export const GuestView: React.FC<GuestViewProps> = ({ guest, navigate, route, paints, children }) => {
  const eventBus = useEventBus();
  const inHostRouter = useInRouterContext();
  const [hostHrefBase, setHostHrefBase] = useState('/');
  const frameRef = useRef<HTMLDivElement>(null);
  const onPath = useCallback((route: string) => {
    if (navigate !== undefined) eventBus.emit(`UI:${navigate}`, { guest, route });
  }, [eventBus, navigate, guest]);
  useInAppLinkInterceptor(frameRef, { enabled: true, isolated: true, hostHrefBase, onPath });
  return (
    <UISlotProvider>
      {paints !== undefined && <SeedGuestPaints paints={paints} />}
      {inHostRouter ? <HostHrefBaseProbe onBase={setHostHrefBase} /> : null}
      <Box ref={frameRef} fullWidth fullHeight className="relative overflow-auto">
        {route === undefined
          ? <UISlotRenderer hudMode="inline" includeHud main={children} />
          : <CurrentPagePathProvider value={route}><UISlotRenderer hudMode="inline" includeHud main={children} /></CurrentPagePathProvider>}
      </Box>
    </UISlotProvider>
  );
};

GuestView.displayName = 'GuestView';

export default GuestView;
