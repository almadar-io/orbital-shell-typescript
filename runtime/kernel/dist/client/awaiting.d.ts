import { AwaitingTrait } from '@almadar/core';

/**
 * Which traits are awaiting a server round trip right now — the kernel contract
 * behind awaiting-server skeletons (`AwaitingTrait`, `@almadar/core`). The
 * client kernel begins an entry right before a server leg's send and ends it
 * when the leg folds or fails; local/hybrid traits and tick legs never enter.
 * Subscriptions are per trait, so only the slots that trait owns re-render.
 */

declare class AwaitingRegistry {
    private readonly entries;
    private readonly listeners;
    private readonly anyListeners;
    private version;
    begin(list: readonly AwaitingTrait[]): void;
    end(traits: readonly string[]): void;
    get(trait: string): AwaitingTrait | undefined;
    list(): AwaitingTrait[];
    subscribe(trait: string, listener: () => void): () => void;
    /** Any trait's awaiting change (an empty slot does not know which trait will fill it). */
    subscribeAll(listener: () => void): () => void;
    /** Bumped on every change — a stable snapshot key for `useSyncExternalStore`. */
    getVersion(): number;
    private emit;
}

export { AwaitingRegistry };
