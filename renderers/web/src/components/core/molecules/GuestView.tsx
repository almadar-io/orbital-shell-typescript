/**
 * GuestView — paints the UI of a guest program session (program/open) inside the opener's view.
 * Paint only: a click on a control inside it is routed by the kernel to the opener as its
 * `deliver` event { guest, address, event, payload }.
 *
 * The guest's own traits are the ones an `@trait.X` inside its paint names, so the view holds a scoped
 * UISlotProvider seeded with every paint the guest made: `TraitFrame` resolves against the guest, not the host.
 * Every slot the guest paints renders inside the view (contained, never the host page's), and an in-app link
 * inside it is the guest's navigation, emitted as `navigate`, never the host router's. Each guest paint is scoped to
 * the trait that drew it (its `orbital`, as a page scopes its own), so a click names its painter for the kernel.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@almadar/logger';
import { useInRouterContext } from 'react-router-dom';
import type { EventKey, PatternNode, UISlot } from '@almadar/core';
import { Box, TraitScopeProvider, useEventBus } from '../../../core';
import { EntitySchemaProvider } from '../../../providers/EntitySchemaContext';
import { UISlotProvider, useUISlots } from '../../../providers/UISlotContext';
import { UISlotRenderer } from '../organisms/UISlotRenderer';
import { HostHrefBaseProbe, useInAppLinkInterceptor } from '../../../lib/inAppLinks';
import { CurrentPagePathProvider } from '../../../providers/CurrentPagePathContext';
import type { SlotProps } from '../../../providers/UISlotContext';
import { convertFnFormLambdasInProps } from '../../../lib/fn-form-lambda';
import { unwrapPattern } from '../../../hooks/circuit/useSlotFlush';
import { isNotificationSlot, paintsInTraitFrame } from '../../../lib/slot-definitions';

const log = createLogger('almadar:ui:guest-view');

export interface GuestPaintEntry {
  /** Slot the guest trait painted */
  slot: UISlot;
  /** Guest trait that painted `content` */
  trait: string;
  /** The guest orbital declaring `trait`: the scope its controls emit under */
  orbital?: string | null;
  /** Whether the trait is embedded (`@trait.X`) on the guest's page rather than the page root */
  embedded: boolean;
  /** The painted pattern tree */
  content: PatternNode | string | null;
}

export interface GuestViewProps {
  /** Guest session handle (`program/open` answers it, e.g. "guest-1"). Data for the kernel; never rendered. */
  guest: string;
  /** The guest's page-root trait whose paint is `children`: their controls are scoped to it. Never rendered. */
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
  const seeded = useRef(new Map<string, GuestPaintEntry>());
  useLayoutEffect(() => {
    // A paint the guest no longer holds was cleared (the session drops a slot its trait painted empty): clear it here too.
    const held = new Set(paints.map((paint) => `${paint.slot}\u0000${paint.trait}`));
    for (const [key, gone] of seeded.current) {
      if (!held.has(key) && !isNotificationSlot(gone.slot)) slotsRef.current.clearBySource(gone.slot, gone.trait);
    }
    seeded.current = new Map(paints.map((paint) => [`${paint.slot}\u0000${paint.trait}`, paint]));
    for (const paint of paints) {
      if (paint.content === null) {
        slotsRef.current.clearBySource(paint.slot, paint.trait);
        continue;
      }
      const { bareTraitRef, patternType, props } = unwrapPattern(paint.content);
      const propsValue: SlotProps | string = bareTraitRef !== undefined ? bareTraitRef : { ...(props ?? {}) };
      const pattern = patternType as string;
      const converted = convertFnFormLambdasInProps(propsValue, typeof patternType === 'string' ? patternType : undefined);
      // An embedded trait's inline paint shows only where an `@trait.X` names it; a portal or page-root paint owns its slot.
      if (paintsInTraitFrame(paint.embedded, paint.slot)) {
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
export const GuestView: React.FC<GuestViewProps> = ({ guest, source, navigate, route, paints, children }) => {
  const eventBus = useEventBus();
  const inHostRouter = useInRouterContext();
  const [hostHrefBase, setHostHrefBase] = useState('/');
  const frameRef = useRef<HTMLDivElement>(null);
  const onPath = useCallback((route: string) => {
    if (navigate !== undefined) eventBus.emit(`UI:${navigate}`, { guest, route });
  }, [eventBus, navigate, guest]);
  useInAppLinkInterceptor(frameRef, { enabled: true, isolated: true, hostHrefBase, onPath });
  const orbitalsByTrait = useMemo(
    () => new Map((paints ?? []).flatMap((paint) => (typeof paint.orbital === 'string' ? [[paint.trait, paint.orbital] as const] : []))),
    [paints],
  );
  const sourceOrbital = orbitalsByTrait.get(source);
  const roots = React.Children.count(children);
  if (roots > 1) log.warn('roots:unscoped', { guest, source, roots });
  const main = roots === 1 && sourceOrbital !== undefined
    ? <TraitScopeProvider orbital={sourceOrbital} trait={source}>{children}</TraitScopeProvider>
    : children;
  return (
    <EntitySchemaProvider orbitalsByTrait={orbitalsByTrait}>
    <UISlotProvider>
      {paints !== undefined && <SeedGuestPaints paints={paints} />}
      {inHostRouter ? <HostHrefBaseProbe onBase={setHostHrefBase} /> : null}
      <Box data-guest-frame="" fullWidth fullHeight className="relative" style={{ contain: 'layout' }}>
        <Box ref={frameRef} fullWidth fullHeight className="relative overflow-auto">
          {route === undefined
            ? <UISlotRenderer hudMode="inline" includeHud main={main} />
            : <CurrentPagePathProvider value={route}><UISlotRenderer hudMode="inline" includeHud main={main} /></CurrentPagePathProvider>}
        </Box>
      </Box>
    </UISlotProvider>
    </EntitySchemaProvider>
  );
};

GuestView.displayName = 'GuestView';

export default GuestView;
