import { IndexedTrait, TraitEventListener, EventId, EventPayload, TraitIndex, BusEventSource } from '@almadar/core';

interface CollectedListenerTarget {
    listenerTrait: string;
    /** The listener's index entry. */
    entry: IndexedTrait;
    /** The matched listener declaration (its `when` already held). */
    listener: TraitEventListener;
    triggers: string;
    triggersId?: EventId;
    payload: EventPayload | undefined;
}
declare function collectListenerTargets(traitIndex: TraitIndex, sourceStamp: BusEventSource | undefined, event: string, payload: EventPayload | undefined): CollectedListenerTarget[];

export { type CollectedListenerTarget, collectListenerTargets };
