/**
 * useBusIngress — the ONE bus subscription: it forwards bus events into the kernel and paints what the kernel answers.
 *
 * Which trait hears an event is the kernel's answer (EXEC-DISP), never this hook's: a component emit lands on its
 * qualified `UI:<Orbital>.<Trait>.<EVENT>` key (the key names the emitting trait) and becomes one settled dispatch of
 * that trait, whose cascade the kernel fans out to the declared `listens` routes. A key that is only some listen's
 * source (the emitter declares no transition on it — the CREATE-button shape) is subscribed the same way: the
 * dispatch of the source trait is the kernel's, and so is its delivery to the listeners. A bare `UI:<EVENT>` key is
 * an emit from outside any trait's scope: it is handed to the kernel as an emitted event (`deliver`), which runs the
 * emitter's own arm and the listeners that name it.
 *
 * A republished kernel echo (`dispatched: true`, its emitter a trait of this app) is dropped: the kernel already
 * delivered it (R-RUNTIME-020, no ping-pong).
 *
 * @packageDocumentation
 */
import { claimDispatch } from '../../lib/bus-claim';
import { useEffect } from 'react';
import type { BusEventSource, EmittedEvent, EventPayload, ResolvedTraitBinding } from '@almadar/core';
import { LIFECYCLE_EVENTS } from '@almadar/core';
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

/** Hand the kernel an emit that entered from outside it; it decides who hears it. */
export type BusEmitDelivery = (emitted: EmittedEvent) => Promise<void>;

export function useBusIngress(
  traitBindings: readonly ResolvedTraitBinding[],
  traitIndex: TraitIndex,
  settle: BusDispatch,
  deliver: BusEmitDelivery,
  eventBus: EventBusContextType,
  /** Every trait of this app, on any page — `traitIndex` holds only the current page's. */
  appTraitNames: ReadonlySet<string>,
): void {
  useEffect(() => {
    const unsubscribes: Array<() => void> = [];
    const subscribedQualified = new Set<string>();
    const subscribedBare = new Set<string>();

    // A republished echo from any trait of THIS app — on this page or off it — was already delivered by the kernel
    // that ran it; only a foreign host's echo may still arrive by name.
    const deliveredHere = (source: BusEventSource | undefined): boolean =>
      source?.dispatched === true &&
      source.trait !== undefined &&
      (traitIndex.byName.has(source.trait) || appTraitNames.has(source.trait));

    const withPending = (source: BusEventSource | undefined, run: () => Promise<void>, failed: Record<string, string>): void => {
      // The firing control's busy state spans this dispatch (lib/pendingDispatch).
      const pendingKey = source?.pendingKey;
      if (pendingKey !== undefined) beginPending(pendingKey);
      void run()
        .catch((err: Error) => {
          log.error('dispatch:failed', { ...failed, error: String(err) });
        })
        .finally(() => {
          if (pendingKey !== undefined) endPending(pendingKey);
        });
    };

    const dispatch = (
      traitName: string,
      eventKey: string,
      payload: EventPayload | undefined,
      source: BusEventSource | undefined,
    ): void => {
      if (!claimDispatch(source, eventKey)) return;
      withPending(source, () => settle(traitName, eventKey, payload, source?.tick), { trait: traitName, event: eventKey });
    };

    const subscribeQualified = (orbitalName: string, traitName: string, eventKey: string): void => {
      const qualifiedKey = `UI:${orbitalName}.${traitName}.${eventKey}`;
      if (subscribedQualified.has(qualifiedKey)) return;
      subscribedQualified.add(qualifiedKey);
      unsubscribes.push(eventBus.on(qualifiedKey, (event) => {
        if (deliveredHere(event.source)) return;
        log.debug('qualified:fire', { key: qualifiedKey });
        dispatch(traitName, eventKey, event.payload, event.source);
      }));
    };

    const subscribeBare = (eventKey: string): void => {
      const bareKey = `UI:${eventKey}`;
      if (subscribedBare.has(bareKey)) return;
      subscribedBare.add(bareKey);
      unsubscribes.push(eventBus.on(bareKey, (event) => {
        if (deliveredHere(event.source)) return;
        const source = event.source;
        const emitted: EmittedEvent = {
          event: eventKey,
          ...(event.payload !== undefined ? { payload: event.payload } : {}),
          ...(source !== undefined ? { source } : {}),
        };
        log.debug('bare:fire', { key: bareKey });
        withPending(source, () => deliver(emitted), { event: eventKey });
      }));
    };

    for (const binding of traitBindings) {
      const traitName = binding.trait.name;
      const orbitalName = traitIndex.byName.get(traitName)?.orbitalName;
      if (orbitalName === undefined) continue;
      for (const transition of binding.trait.transitions) {
        const eventKey = transition.event;
        if ((LIFECYCLE_EVENTS as readonly string[]).includes(eventKey)) continue;
        subscribeQualified(orbitalName, traitName, eventKey);
        subscribeBare(eventKey);
      }
      // A listen's source key is the emitter's own dispatch: the kernel fans it out to the listeners.
      const ownOrbital = orbitalName;
      for (const listen of binding.trait.listens ?? []) {
        const src = listen.source;
        if (src === undefined || src.kind === 'any') {
          subscribeBare(listen.event);
          continue;
        }
        subscribeQualified((src.kind === 'orbital' ? src.orbital : undefined) ?? ownOrbital, src.trait, listen.event);
        subscribeBare(listen.event);
      }
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [traitBindings, traitIndex, settle, deliver, eventBus, appTraitNames]);
}
