/**
 * CircuitStore — P2, `docs/Almadar_Runtime_Stateless_Stateful_PLAN.md` §4.2.
 *
 * The browser client's circuit state: each trait's state and entity frame as the kernel last reported them.
 *
 * `snapshot`/`restore` are the JS twin of orbital-core's
 * `RuntimeKernel::snapshot_trait`/`restore_trait` (`runtime/kernel.rs`) — the
 * `runtimeOptimistic` rollback point. `subscribe`/`getVersion` let a later
 * React adapter drive `useSyncExternalStore` off this store without the
 * store knowing anything about React.
 *
 * @packageDocumentation
 */
import { AwaitingRegistry } from './awaiting.js';
import { StateBook } from './state-book.js';
import type { EntityRow, EventPayload } from '@almadar/core';
import type { FrameDelta } from '@almadar/core/kernel-wire';
import type { TraitDefinition } from '@almadar/core';
import type { RollbackCause, TransitionObserver } from './trait-types.js';

/**
 * A trait instance's state + entity frame at a point in time — the twin of
 * orbital-core's `TraitSnapshot { state, entity }`. `frame` is `undefined`
 * when the trait had no frame row yet (mirrors Rust's `Value::Null` case:
 * restoring must leave the row absent, not invent one).
 */
export interface TraitSnapshot {
  state: string;
  frame: EntityRow | undefined;
}

/**
 * What a frame delta did to the store: `applied`; `stale` (its version is behind the one painted: dropped, so an
 * old repaint never overwrites a newer value); `gap` (it starts past the painted version: nothing applied, the
 * caller asks the kernel for `framesSince(frameVersion)` and applies the snapshot).
 */
export type FrameOutcome = 'applied' | 'stale' | 'gap';

export interface CircuitStore {
  /** Each trait's state as the kernel last reported it. */
  readonly states: StateBook;
  /** The entity-frame map (`(set @entity.X)` writes), keyed by
   *  `IndexedTrait.frameKey`. */
  readonly frames: Map<string, EntityRow>;
  /** The version of the kernel's frame record this store has painted. */
  readonly frameVersion: number;
  /**
   * Paint the kernel's frame delta (EXEC-DIST-7): ops land only at the version they start from, and a snapshot
   * (`from` 0 with a leading `clear`) always lands. The store merges nothing by its own rules.
   */
  applyFrames(delta: FrameDelta): FrameOutcome;
  /** Embedded child → the payload its composer last composed it with (sticky `@callsitePayload`). */
  readonly callsitePayloads: Map<string, EventPayload>;
  /** Traits awaiting a server round trip (per-trait subscriptions; see `AwaitingRegistry`). */
  readonly awaiting: AwaitingRegistry;
  /**
   * Capture `trait`'s current state + its frame row, for a
   * `runtimeOptimistic` dispatch's pre-commit rollback point. `frameKey`
   * defaults to `trait` (the non-`[shared]`-entity case); a caller holding
   * the trait's `IndexedTrait.frameKey` (the `[shared]` case) passes it
   * explicitly so the snapshot reads the SAME row the dispatch will write.
   */
  snapshot(trait: string, entityId?: string, frameKey?: string): TraitSnapshot;
  /**
   * Roll `trait` back to a prior snapshot: state via a reconcile write (no
   * guard evaluation — `rollbackState`, which reports the hop to the observer), frame via REPLACE (never merge — an
   * optimistic commit may have added fields since the snapshot that a merge
   * would keep, the same reasoning as `RuntimeKernel::restore_trait`).
   */
  restore(trait: string, entityId: string | undefined, snapshot: TraitSnapshot, frameKey: string | undefined, cause: RollbackCause): void;
  /**
   * Notify subscribers that circuit state changed. Callers (the client
   * role, `client-role.ts`) call this ONCE after a dispatch/fold finishes
   * writing state — the store never fires this on its own.
   */
  notify(): void;
  /** `useSyncExternalStore`-shaped subscription. Returns the unsubscribe fn. */
  subscribe(listener: () => void): () => void;
  /** Monotonic version, bumped by every `notify()` call. */
  getVersion(): number;
}

/**
 * The one in-memory `CircuitStore` implementation. Per-request (stateless
 * server) or long-lived (stateful server, browser client) is only a
 * question of how long the caller HOLDS the returned store — the
 * implementation itself carries no lifetime opinion.
 */
export function createMemoryCircuitStore(
  traits: readonly TraitDefinition[] = [],
  observer?: TransitionObserver,
): CircuitStore {
  const states = new StateBook(traits, observer);
  const frames = new Map<string, EntityRow>();
  const listeners = new Set<() => void>();
  let version = 0;
  let frameVersion = 0;
  let frameSession: string | undefined;

  return {
    states,
    frames,
    get frameVersion() {
      return frameVersion;
    },
    applyFrames(delta) {
      if (delta.session !== undefined) {
        const snapshot = delta.from === 0 && delta.ops[0]?.[0] === 'clear';
        if (!snapshot) {
          const current = (frameSession === undefined || delta.session === frameSession) && delta.from === frameVersion;
          if (delta.session === frameSession && delta.to <= frameVersion && !current) return 'stale';
          if (!current) return 'gap';
        }
        frameSession = delta.session;
        frameVersion = delta.to;
      }
      for (const op of delta.ops) {
        switch (op[0]) {
          case 'clear':
            frames.clear();
            break;
          case 'del':
            frames.delete(op[1]);
            break;
          case 'put':
            frames.set(op[1], { ...op[2] });
            break;
          case 'set':
            for (const [frame, fields] of Object.entries(op[1])) frames.set(frame, { ...(frames.get(frame) ?? {}), ...fields });
            break;
        }
      }
      return 'applied';
    },
    callsitePayloads: new Map<string, EventPayload>(),
    awaiting: new AwaitingRegistry(),
    snapshot(trait, entityId, frameKey) {
      const key = frameKey ?? trait;
      const frame = frames.get(key);
      return {
        state: states.getState(trait, entityId)?.currentState ?? '',
        frame: frame !== undefined ? { ...frame } : undefined,
      };
    },
    restore(trait, entityId, snap, frameKey, cause) {
      const key = frameKey ?? trait;
      if (snap.state !== '') {
        states.rollbackState(trait, snap.state, entityId, cause);
      }
      if (snap.frame === undefined) {
        frames.delete(key);
      } else {
        frames.set(key, { ...snap.frame });
      }
    },
    notify() {
      version += 1;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion() {
      return version;
    },
  };
}
