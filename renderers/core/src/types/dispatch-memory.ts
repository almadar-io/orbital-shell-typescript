// The path memory of one dispatch (Runtime Spec Clause 5.5), shared by the JS runtime and compiled clients.
// Twin of orbital-core `runtime::dispatch_memory`.
import type { EventPayload } from './expression.js';
import { deliveryRecordValue, type DeliveryRecord, type DispatchLog } from './bus.js';

/** What a guard or effect reads: `@event`, `@prevEvents`, `@prevStates`. */
export interface DispatchScope {
  event: EventPayload;
  prevEvents: EventPayload[];
  prevStates: string[];
}

/** The scope of a delivery with the given log so far; no delivery = a direct dispatch of `event`. */
export function dispatchScopeOf(
  delivery: DeliveryRecord | undefined,
  log: DispatchLog | undefined,
  event: string,
  payload: EventPayload | undefined,
): DispatchScope {
  const record = delivery ?? { event, ...(payload !== undefined ? { payload } : {}), source: {} };
  return {
    event: deliveryRecordValue(record),
    prevEvents: (log?.prevEvents ?? []).map(deliveryRecordValue),
    prevStates: [...(log?.prevStates ?? [])],
  };
}

export class DispatchMemory {
  private readonly deliveries = new Map<string, DeliveryRecord[]>();
  private readonly left = new Map<string, string[]>();

  /** This trait's log so far, as it travels on a request. */
  log(trait: string): DispatchLog {
    return { prevEvents: [...(this.deliveries.get(trait) ?? [])], prevStates: [...(this.left.get(trait) ?? [])] };
  }

  view(trait: string, delivery: DeliveryRecord): DispatchScope {
    return dispatchScopeOf(delivery, this.log(trait), delivery.event, delivery.payload);
  }

  /** Continue a dispatch that began elsewhere: the target trait's log so far. */
  seed(trait: string, log: DispatchLog): void {
    this.deliveries.set(trait, [...log.prevEvents]);
    this.left.set(trait, [...log.prevStates]);
  }

  recordDelivery(trait: string, delivery: DeliveryRecord): void {
    const log = this.deliveries.get(trait) ?? [];
    log.push(delivery);
    this.deliveries.set(trait, log);
  }

  recordTransition(trait: string, from: string, to: string): void {
    if (from === to) return;
    const log = this.left.get(trait) ?? [];
    log.push(from);
    this.left.set(trait, log);
  }
}
