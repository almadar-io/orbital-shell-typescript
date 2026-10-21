/**
 * useBusIngress — W5b (docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §5.1 G2).
 *
 * The ONE bus subscription: a component still emits onto the event bus
 * exactly as before (`TraitScopeProvider`'s qualified `UI:<Orbital>.<Trait>.
 * <EVENT>` key; a composed atom's own `(emit EVENT)` reaching sibling atoms
 * via the bare `UI:<EVENT>` key). This hook's job is translating that
 * bus key into one settled dispatch (`dispatch`, the composer's
 * `dispatchAndSettle`: kernel dispatch → slot flush) — no echo dropping, no
 * effect-name scans. The kernel's own composition
 * (`evaluateOrbitalEvent`'s `collectListenerTargets` fan-out, run internally
 * by `dispatchWithServerLeg`) owns cross-trait `listens{}` delivery for
 * events that ENTER through a dispatch; the `listen-source` subscription
 * block below additionally routes bus-originated emits that land on a
 * declared listen SOURCE key straight to the listener (the emitter declares
 * no transition on the event — the CREATE-button shape), which no dispatch
 * entry point would otherwise see.
 *
 * R-RUNTIME-020 (no ping-pong): the kernel's emit sink is in-memory and
 * feeds only its own listen fan-out. The composer republishes those emits
 * on the real bus with `dispatched: true` for subscribers outside the
 * kernel; this hook drops a republished emit whose source trait is in its
 * own `traitIndex`, since the kernel already delivered it.
 *
 * A tick's bare-key emit reaches its own trait's arm for the event and,
 * through the declared `listens` routes below, its listeners (G-UI-103
 * retired: a sibling with a same-name arm and no `listens` does not hear it).
 * Any other bare-key emit fans to every trait `traitIndex` holds that
 * transitions on the event — `dispatchWithServerLeg` requires exactly one
 * seed trait per call (plan §4.2 P4), so that broadcast becomes N
 * single-trait `kernel.dispatch` calls; the kernel's own FIFO queue (plan
 * §5.1 G1) serializes them.
 *
 * @packageDocumentation
 */
import { claimDelivery } from '../../lib/bus-claim';
import { useEffect } from 'react';
import type { BusEventSource, EventPayload, ResolvedTraitBinding, SExpr } from '@almadar/core';
import { applyListenMapping, LIFECYCLE_EVENTS } from '@almadar/core';
import { collectListenerTargets } from '../../runtime';
import type { TraitIndex } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import type { EventBusContextType } from '../../core';
import { beginPending, endPending } from '../../core';

const log = createLogger('almadar:ui:circuit:bus-ingress');

export type BusDispatch = (
  traitName: string,
  eventKey: string,
  payload: EventPayload | undefined,
  tick?: string,
) => Promise<void>;

/** One listen route behind a shared qualified source key. */
interface ListenRoute {
  listenerTrait: string;
  triggers: string;
  payloadMapping: Record<string, SExpr> | undefined;
}

export function useBusIngress(
  traitBindings: readonly ResolvedTraitBinding[],
  traitIndex: TraitIndex,
  settle: BusDispatch,
  eventBus: EventBusContextType,
  /** Every trait of this app, on any page — `traitIndex` holds only the current page's. */
  appTraitNames: ReadonlySet<string>,
): void {
  useEffect(() => {
    const unsubscribes: Array<() => void> = [];
    const subscribedQualified = new Set<string>();
    const subscribedBare = new Set<string>();

    // A republished echo from any trait of THIS app — on this page or off it —
    // was already delivered through its declared routes (the kernel's listen
    // fan-out, or the server's for an off-page emitter); only a foreign host's
    // echo may still arrive by name.
    const deliveredHere = (source: BusEventSource | undefined): boolean =>
      source?.dispatched === true &&
      source.trait !== undefined &&
      (traitIndex.byName.has(source.trait) || appTraitNames.has(source.trait));

    const dispatch = (
      traitName: string,
      eventKey: string,
      payload: EventPayload | undefined,
      source: BusEventSource | undefined,
    ): void => {
      if (!claimDelivery(source, traitName, eventKey)) return;
      const tick = source?.tick;
      // The firing control's busy state spans this dispatch (lib/pendingDispatch).
      const pendingKey = source?.pendingKey;
      if (pendingKey !== undefined) beginPending(pendingKey);
      void settle(traitName, eventKey, payload, tick)
        .catch((err: Error) => {
          log.error('dispatch:failed', { trait: traitName, event: eventKey, error: String(err) });
        })
        .finally(() => {
          if (pendingKey !== undefined) endPending(pendingKey);
        });
    };

    for (const binding of traitBindings) {
      const traitName = binding.trait.name;
      const orbitalName = traitIndex.byName.get(traitName)?.orbitalName;
      if (orbitalName === undefined) continue;

      for (const transition of binding.trait.transitions) {
        const eventKey = transition.event;
        if ((LIFECYCLE_EVENTS as readonly string[]).includes(eventKey)) continue;

        const qualifiedKey = `UI:${orbitalName}.${traitName}.${eventKey}`;
        if (!subscribedQualified.has(qualifiedKey)) {
          subscribedQualified.add(qualifiedKey);
          const unsub = eventBus.on(qualifiedKey, (event) => {
            if (deliveredHere(event.source)) return;
            log.debug('qualified:fire', { key: qualifiedKey });
            dispatch(traitName, eventKey, event.payload, event.source);
          });
          unsubscribes.push(unsub);
        }

        const bareKey = `UI:${eventKey}`;
        if (!subscribedBare.has(bareKey)) {
          subscribedBare.add(bareKey);
          const unsub = eventBus.on(bareKey, (event) => {
            if (deliveredHere(event.source)) return;
            // A tick's `(emit X)` (stamped with its `tick`) reaches its own trait's arm for the event (the
            // same-trait cascade) and every declared `listens` route (the `listen-bare` block below) —
            // never a sibling that merely has an arm of that name (G-UI-103 retired).
            const tickEmitter = event.source?.tick !== undefined ? event.source.trait : undefined;
            const routed = event.source?.dispatched === true
              ? new Set(collectListenerTargets(traitIndex, event.source, eventKey, event.payload).map((t) => t.listenerTrait))
              : undefined;
            for (const [name, entry] of traitIndex.byName) {
              if (tickEmitter !== undefined && name !== tickEmitter) continue;
              if (!entry.traitDef.transitions.some((t: { event: string }) => t.event === eventKey)) continue;
              if (routed?.has(name) === true) continue;
              log.debug('bare:fire', { key: bareKey, trait: name });
              dispatch(name, eventKey, event.payload, event.source);
            }
          });
          unsubscribes.push(unsub);
        }
      }
    }

    // Listen-source keys: an event whose ONLY circuit meaning is a declared
    // `listens` source — the emitter trait declares no transition on it, so
    // neither subscription above matches, and a component-originated emit on
    // the source key (e.g. std-api-gateway's "Create Route" button:
    // RouteCatalog renders the button, declares no CREATE transition;
    // RouteCreate `listens { RouteCatalog CREATE -> CREATE }`) previously
    // reached nothing and the click was a no-op. The pre-W5b hook covered
    // this with its `listen:subscribe` block; the adapter refactor dropped
    // it. One subscription per qualified source key; each fire settles every
    // listener registered for that key through the SAME kernel dispatch as
    // any other event (payload mapping applied — the client twin of the
    // composition's fan-out). Kernel-republished echoes (`dispatched: true`
    // from one of THIS kernel's traits) are skipped: the kernel's own
    // in-run `collectListenerTargets` fan-out already delivered those.
    const listenRoutesByKey = new Map<string, ListenRoute[]>();
    for (const binding of traitBindings) {
      const listenerName = binding.trait.name;
      const ownOrbital = traitIndex.byName.get(listenerName)?.orbitalName;
      if (ownOrbital === undefined) continue;
      for (const listen of binding.trait.listens ?? []) {
        const src = listen.source;
        if (src === undefined || src.kind === 'any') continue;
        const sourceOrbital = (src.kind === 'orbital' ? src.orbital : undefined) ?? ownOrbital;
        const sourceKey = `UI:${sourceOrbital}.${src.trait}.${listen.event}`;
        const route: ListenRoute = {
          listenerTrait: listenerName,
          triggers: listen.triggers,
          payloadMapping: listen.payloadMapping,
        };
        const routes = listenRoutesByKey.get(sourceKey);
        if (routes) routes.push(route);
        else listenRoutesByKey.set(sourceKey, [route]);
      }
    }
    for (const [sourceKey, routes] of listenRoutesByKey) {
      // The source trait declares the event: its qualified subscription dispatches it and the kernel fans it out to these listens.
      if (subscribedQualified.has(sourceKey)) continue;
      const unsub = eventBus.on(sourceKey, (event) => {
        if (deliveredHere(event.source)) return;
        for (const route of routes) {
          log.debug('listen-source:fire', { key: sourceKey, listener: route.listenerTrait, triggers: route.triggers });
          dispatch(
            route.listenerTrait,
            route.triggers,
            applyListenMapping(route.payloadMapping, event.payload),
            event.source,
          );
        }
      });
      unsubscribes.push(unsub);
    }

    // An emit that ran outside the kernel (a tick, a lifecycle re-run) goes out on its bare key with its
    // emitter stamped on `source`, and no kernel fan-out delivered it: route it to the declared listens here.
    const routedBareEvents = new Set<string>();
    for (const binding of traitBindings) {
      for (const listen of binding.trait.listens ?? []) {
        if (listen.source !== undefined && listen.source.kind !== 'any') routedBareEvents.add(listen.event);
      }
    }
    for (const eventKey of routedBareEvents) {
      const unsub = eventBus.on(`UI:${eventKey}`, (event) => {
        if (deliveredHere(event.source) || event.source?.trait === undefined) return;
        for (const target of collectListenerTargets(traitIndex, event.source, eventKey, event.payload)) {
          log.debug('listen-bare:fire', { event: eventKey, source: event.source.trait, listener: target.listenerTrait, triggers: target.triggers });
          dispatch(target.listenerTrait, target.triggers, target.payload, event.source);
        }
      });
      unsubscribes.push(unsub);
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [traitBindings, traitIndex, settle, eventBus, appTraitNames]);
}
