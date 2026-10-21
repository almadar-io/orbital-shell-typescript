/**
 * Pending dispatches — the busy state of the control that fired an action.
 *
 * A control stamps a fresh `pendingKey` on the event it emits (`BusEventSource`).
 * The bus ingress (and the compiled shell's listeners) mark that key busy from
 * the moment a dispatch starts until it settles — success or failure — so the
 * control shows busy for exactly its own dispatches, nothing inferred and no
 * other part of the page touched. Bus delivery is synchronous: once `emit`
 * returns, every dispatch the event started has already begun, so a key with
 * no dispatches is known to be idle immediately.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";

const counts = new Map<string, number>();
const keyListeners = new Map<string, Set<() => void>>();
let seq = 0;

function notify(key: string): void {
  keyListeners.get(key)?.forEach((cb) => cb());
}

/** A fresh key for one activation of a control. */
export function newPendingKey(): string {
  seq += 1;
  return `pending-${seq}`;
}

/** A dispatch carrying `key` started. */
export function beginPending(key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (counts.get(key) === 1) notify(key);
}

/** A dispatch carrying `key` settled. */
export function endPending(key: string): void {
  const n = (counts.get(key) ?? 0) - 1;
  if (n > 0) {
    counts.set(key, n);
    return;
  }
  counts.delete(key);
  notify(key);
}

export function isPending(key: string): boolean {
  return (counts.get(key) ?? 0) > 0;
}

export function subscribePending(key: string, cb: () => void): () => void {
  let set = keyListeners.get(key);
  if (!set) {
    set = new Set();
    keyListeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) keyListeners.delete(key);
  };
}

/**
 * A region (a modal) that holds still while an action started inside it is in
 * flight: its confirm button stays busy and the dialog does not leave before
 * the action settles.
 */
export interface PendingScopeValue {
  track: (key: string) => void;
  hasPending: () => boolean;
  subscribe: (cb: () => void) => () => void;
}

export const PendingScopeContext = createContext<PendingScopeValue | null>(null);

/** Builds the value a `PendingScopeContext.Provider` carries. */
export function usePendingScopeValue(): PendingScopeValue {
  const keys = useRef(new Set<string>());
  const listeners = useRef(new Set<() => void>());
  const emitChange = useCallback(() => listeners.current.forEach((cb) => cb()), []);
  return useState<PendingScopeValue>(() => ({
    track: (key: string) => {
      if (!isPending(key)) return;
      keys.current.add(key);
      emitChange();
      const unsub = subscribePending(key, () => {
        if (isPending(key)) return;
        keys.current.delete(key);
        unsub();
        emitChange();
      });
    },
    hasPending: () => keys.current.size > 0,
    subscribe: (cb: () => void) => {
      listeners.current.add(cb);
      return () => listeners.current.delete(cb);
    },
  }))[0];
}

/** Whether the nearest pending scope (or the given one) has an action in flight. */
export function useScopeHasPending(scope: PendingScopeValue | null): boolean {
  return useSyncExternalStore(
    useCallback((cb: () => void) => (scope ? scope.subscribe(cb) : () => {}), [scope]),
    () => (scope ? scope.hasPending() : false),
    () => false,
  );
}

/**
 * One control's busy state. `activate(emit)` hands `emit` a fresh key to stamp
 * on the event it sends; `pending` is true until every dispatch that event
 * started has settled.
 */
export function usePendingAction(): { pending: boolean; activate: (emit: (pendingKey: string) => void) => void } {
  const scope = useContext(PendingScopeContext);
  const [key, setKey] = useState<string | null>(null);
  const pending = useSyncExternalStore(
    useCallback((cb: () => void) => (key ? subscribePending(key, cb) : () => {}), [key]),
    () => (key ? isPending(key) : false),
    () => false,
  );
  useEffect(() => {
    if (key && !pending) setKey(null);
  }, [key, pending]);
  const activate = useCallback((emit: (pendingKey: string) => void) => {
    const k = newPendingKey();
    emit(k);
    if (!isPending(k)) return;
    scope?.track(k);
    setKey(k);
  }, [scope]);
  return { pending, activate };
}

/**
 * Busy state per row of a collection: a row action marks ITS row pending while
 * the dispatches it started are in flight.
 */
export function usePendingRows(): { isRowPending: (rowId: string) => boolean; activateRow: (rowId: string, emit: (pendingKey: string) => void) => void } {
  const [rows, setRows] = useState<ReadonlyMap<string, string>>(new Map());
  const unsubs = useRef(new Map<string, () => void>());
  useEffect(() => () => unsubs.current.forEach((u) => u()), []);
  const activateRow = useCallback((rowId: string, emit: (pendingKey: string) => void) => {
    const k = newPendingKey();
    emit(k);
    if (!isPending(k)) return;
    setRows((prev) => new Map(prev).set(rowId, k));
    unsubs.current.get(rowId)?.();
    unsubs.current.set(rowId, subscribePending(k, () => {
      if (isPending(k)) return;
      unsubs.current.get(rowId)?.();
      unsubs.current.delete(rowId);
      setRows((prev) => {
        if (prev.get(rowId) !== k) return prev;
        const next = new Map(prev);
        next.delete(rowId);
        return next;
      });
    }));
  }, []);
  const isRowPending = useCallback((rowId: string) => rows.has(rowId), [rows]);
  return { isRowPending, activateRow };
}
