/**
 * GuestView — paints the UI of a guest program session (program/open) inside the opener's view.
 * Paint only: a click on a control inside it is routed by the kernel to the opener as its
 * `deliver` event { guest, address, event, payload }.
 *
 * The guest's own traits are the ones an `@trait.X` inside its paint names, so the view holds a scoped
 * UISlotProvider seeded with every paint the guest made: `TraitFrame` resolves against the guest, not the host.
 * Every slot the guest paints renders inside the view (contained, never the host page's), and an in-app link
 * inside it is the guest's navigation, emitted as `navigate`, never the host router's. Each guest paint is scoped to
 * the trait that drew it (its `orbital`, as a page scopes its own), so a click names its painter for the kernel; a page with
 * several roots names them in `roots`, one per child.
 * The guest paints in the theme its program declares (`theme`), never the opener's, unless the opener passes its viewer's pick (`themeOverride`).
 * A guest opened split (`program/open { split: true }`) is handed to the view as its client `program`: the view runs its
 * `[client]` traits in a kernel of its own, as a served app's page does, and posts each server leg to the opener as its
 * declared `leg` event; the opener hands each answer back in `legAnswers`, and the view takes it with `legTaken`.
 */
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@almadar/logger';
import { useInRouterContext } from 'react-router-dom';
import type { EventKey, OrbitalSchema, PatternNode, ThemeRef, UISlot } from '@almadar/core';
import { createChannelTransport, type ChannelMessage } from '@almadar/shell-runtime/client/channel-transport';
import type { TransitionTap } from '../../../hooks/circuit/transitionTap';

type TransitionTrace = Parameters<TransitionTap>[0];
import { Box, TraitScopeProvider, useEventBus } from '../../../core';
import { EntitySchemaProvider } from '../../../providers/EntitySchemaContext';
import { UISlotProvider, useUISlots } from '../../../providers/UISlotContext';
import { UISlotRenderer } from '../organisms/UISlotRenderer';
import { HostHrefBaseProbe, useInAppLinkInterceptor } from '../../../lib/inAppLinks';
import { CurrentPagePathProvider } from '../../../providers/CurrentPagePathContext';
import { OrbitalThemeProvider } from '../../../providers/OrbitalThemeProvider';
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

/** One answered server leg of a split guest: the events request's answer as the guest's host wrote it, or why it failed. */
export interface GuestLegAnswer {
  /** The leg the view posted, as named in its `leg` event. */
  leg: string;
  /** The `EventResponse` the guest's host answered, as JSON text. */
  response?: string;
  /** Why the leg could not be answered. */
  error?: string;
}

export interface GuestViewProps {
  /** Guest session handle (`program/open` answers it, e.g. "guest-1"). Data for the kernel; never rendered. */
  guest: string;
  /** The guest's page-root trait whose paint is `children`: their controls are scoped to it. Never rendered. */
  source: string;
  /** The guest's page-root traits that painted `children`, in the same order: child N is the paint of `roots[N]`, so its controls are scoped to that trait. Needed when the page has more than one root. Never rendered. */
  roots?: ReadonlyArray<string>;
  /** The opener trait's declared event a click inside this view is delivered as. The kernel emits it, never the renderer. */
  deliver: EventKey;
  /** The opener trait's declared event an in-app link inside this view is emitted as, with { guest, route }. Without it a link inside the guest does nothing. */
  navigate?: EventKey;
  /** The guest's current route (`program/open` and `program/navigate` answer it): the current page path of everything inside, so the guest's navigation shows its own active page and closes its own drawers. */
  route?: string;
  /** Every paint the guest made (`rendered` entries, the latest per trait and slot). An `@trait.X` inside the content resolves to the guest's trait X from these. */
  paints?: ReadonlyArray<GuestPaintEntry>;
  /** The theme the guest program declares (its app `theme`: a registry key or an inline definition). The guest paints inside it, whatever theme the opener's page runs. */
  theme?: ThemeRef;
  /** A theme the opener's viewer picked (a registry key): it replaces the guest's own theme. */
  themeOverride?: string;
  /** The guest's client program, when it was opened split: the view runs its `[client]` traits itself and paints them. */
  program?: OrbitalSchema;
  /** The opener trait's declared event a split guest's server leg is emitted as, with { guest, leg, orbital, body }: `body` is the events request as JSON text. */
  leg?: EventKey;
  /** The opener trait's declared event emitted with { guest, leg } once the view has taken that leg's answer. */
  legTaken?: EventKey;
  /** The answered legs the opener holds for this view. */
  legAnswers?: ReadonlyArray<GuestLegAnswer>;
  /** The opener trait's declared event a split guest's view reports the transitions its kernel took as, with { guest, moves: [{ trait, event, from, to, fired }] }, one per settled batch. */
  moved?: EventKey;
  /** The opener trait's declared event a split guest's view emits with { guest, returnTo } when its page sends the viewer to the host's sign-in (an `access: authenticated` page and no signed-in viewer). */
  signIn?: EventKey;
  /** Whether the split guest's viewer session is signed in: its `access: authenticated` pages mount only when it is. */
  signedIn?: boolean;
  /** How many times the opener told a split guest's view to mount its page afresh (its viewer was signed in as another persona): a new value starts the view again. */
  epoch?: number;
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

const OrbPreview = React.lazy(() => import('../../../preview/OrbPreview').then((m) => ({ default: m.OrbPreview })));

const NO_ANSWERS: ReadonlyArray<GuestLegAnswer> = [];

/** A split guest: its client program runs here, its server legs travel to the opener as `leg` events. */
type GuestMove = { trait: string; event: string; from: string; to: string; fired: boolean };

function SplitGuest({ guest, epoch, program, leg, legTaken, legAnswers, moved, signIn, signedIn, route, themeOverride }: {
  guest: string;
  epoch: number;
  moved?: EventKey;
  signIn?: EventKey;
  signedIn: boolean;
  program: OrbitalSchema;
  leg: EventKey;
  legTaken?: EventKey;
  legAnswers: ReadonlyArray<GuestLegAnswer>;
  route?: string;
  themeOverride?: string;
}): React.ReactElement {
  const eventBus = useEventBus();
  const bus = useRef(eventBus);
  bus.current = eventBus;
  // The view is keyed by guest, so this is one opened program: a repaint of the stage hands an equal program anew, which must not restart it.
  const opened = useRef(program);
  const guestProgram = opened.current;
  const listeners = useRef(new Set<(message: ChannelMessage) => void>());
  const transport = useMemo(() => {
    const hear = (message: ChannelMessage) => listeners.current.forEach((listener) => listener(message));
    return createChannelTransport({
      post(message) {
        if (message.almadarChannel === 'register') {
          queueMicrotask(() => hear({ almadarChannel: 'registered', id: message.id, held: true }));
          return;
        }
        if (message.almadarChannel !== 'send') return;
        bus.current.emit(`UI:${leg}`, { guest, leg: `${guest}:${epoch}:${message.id}`, orbital: message.orbitalName, body: JSON.stringify(message.request) });
      },
      onMessage(listener) {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    });
  }, [guest, epoch, leg]);
  useEffect(() => {
    for (const answer of legAnswers) {
      const prefix = `${guest}:${epoch}:`;
      const id = Number(answer.leg.slice(prefix.length));
      if (!answer.leg.startsWith(prefix) || !Number.isInteger(id)) continue;
      const response = answer.response !== undefined
        ? JSON.parse(answer.response)
        : { success: false, transitioned: false, states: {}, emittedEvents: [], error: answer.error ?? 'The guest did not answer the leg' };
      listeners.current.forEach((listener) => listener({ almadarChannel: 'reply', id, response }));
      if (legTaken !== undefined) bus.current.emit(`UI:${legTaken}`, { guest, leg: answer.leg });
    }
  }, [legAnswers, legTaken, guest, epoch]);
  const pendingMoves = useRef<GuestMove[]>([]);
  // The view loads until the viewer first presses or types in it; from then on its moves are the viewer's own.
  const acted = useRef(false);
  const onViewerInput = useCallback(() => { acted.current = true; }, []);
  const onTransition = useCallback((trace: TransitionTrace) => {
    if (moved === undefined) return;
    pendingMoves.current.push({ trait: trace.traitName, event: trace.event, from: trace.from, to: trace.to, fired: trace.firedArm !== undefined });
    if (pendingMoves.current.length > 1) return;
    queueMicrotask(() => {
      const moves = pendingMoves.current;
      pendingMoves.current = [];
      bus.current.emit(`UI:${moved}`, { guest, moves, input: acted.current });
    });
  }, [moved, guest]);
  const onSignIn = useCallback((returnTo?: string) => {
    if (signIn !== undefined) bus.current.emit(`UI:${signIn}`, { guest, returnTo: returnTo ?? '' });
  }, [signIn, guest]);
  return (
    <Box fullWidth fullHeight onPointerDownCapture={onViewerInput} onKeyDownCapture={onViewerInput}>
    <Suspense fallback={null}>
      <OrbPreview schema={guestProgram} transport={transport} onTransition={onTransition} onSignIn={onSignIn} authority={signedIn ? 'authenticated' : 'anonymous'} isolated frame="contained" height="100%" initialPagePath={route} themeOverride={themeOverride} />
    </Suspense>
    </Box>
  );
}

/**
 * GuestView - Paints a guest program's UI; guest, source and deliver are kernel routing data
 */
export const GuestView: React.FC<GuestViewProps> = ({ guest, source, roots, navigate, route, paints, theme, themeOverride, program, leg, legTaken, legAnswers, epoch, moved, signIn, signedIn, children }) => {
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
  if (program !== undefined && leg !== undefined) {
    return (
      <Box data-guest-frame="" fullWidth fullHeight className="relative" style={{ contain: 'layout' }}>
        <SplitGuest key={`${guest}:${epoch ?? 0}`} guest={guest} epoch={epoch ?? 0} program={program} leg={leg} legTaken={legTaken} legAnswers={legAnswers ?? NO_ANSWERS} moved={moved} signIn={signIn} signedIn={signedIn === true} route={route} themeOverride={themeOverride} />
      </Box>
    );
  }
  const painted = React.Children.toArray(children);
  const painters = roots ?? (painted.length === 1 ? [source] : []);
  const paired = painters.length === painted.length;
  if (!paired) log.warn('roots:unscoped', { guest, source, roots: painters, children: painted.length });
  const main = paired
    ? painted.map((child, index) => {
        const trait = painters[index];
        const orbital = orbitalsByTrait.get(trait);
        return orbital === undefined
          ? <React.Fragment key={`${index}:${trait}`}>{child}</React.Fragment>
          : <TraitScopeProvider key={`${index}:${trait}`} orbital={orbital} trait={trait}>{child}</TraitScopeProvider>;
      })
    : children;
  return (
    <EntitySchemaProvider orbitalsByTrait={orbitalsByTrait}>
    <UISlotProvider>
      {paints !== undefined && <SeedGuestPaints paints={paints} />}
      {inHostRouter ? <HostHrefBaseProbe onBase={setHostHrefBase} /> : null}
      <Box data-guest-frame="" fullWidth fullHeight className="relative" style={{ contain: 'layout' }}>
        <Box ref={frameRef} fullWidth fullHeight className="relative overflow-auto">
          <OrbitalThemeProvider theme={theme} override={themeOverride}>
            {route === undefined
              ? <UISlotRenderer hudMode="inline" includeHud main={main} />
              : <CurrentPagePathProvider value={route}><UISlotRenderer hudMode="inline" includeHud main={main} /></CurrentPagePathProvider>}
          </OrbitalThemeProvider>
        </Box>
      </Box>
    </UISlotProvider>
    </EntitySchemaProvider>
  );
};

GuestView.displayName = 'GuestView';

export default GuestView;
