/**
 * `DispatchMode` / `computeDispatchMode` — the TS mirror of `orbital-core`'s
 * `runtime::dispatch_mode::compute` (`orbital-rust/crates/orbital-core/src/
 * runtime/dispatch_mode.rs`). Row for row against that file's
 * `dispatch_mode_rule_table`; this package cannot read the Rust source at test
 * time (package tests never climb to siblings), so the table is encoded
 * literally here. The `touchesServer` fact itself (the fold-aware effect row)
 * is derived and tested in `@almadar/runtime` (`dispatch-mode-derived.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
    computeDispatchMode,
    computeTraitDispatchMode,
    DispatchModeSchema,
    type DispatchMode,
    type Entity,
} from '../index';

describe('computeDispatchMode', () => {
    it('local wins over every entity and effect-row combination', () => {
        for (const [runtime, server] of [[true, true], [true, false], [false, true], [false, false]] as const) {
            expect(computeDispatchMode(true, runtime, server), `runtime=${runtime} server=${server}`).toBe<DispatchMode>('hybridClientOnly');
        }
    });

    it('a [runtime] trait is client-only unless its own effects reach the server', () => {
        expect(computeDispatchMode(false, true, false)).toBe<DispatchMode>('hybridClientOnly');
        expect(computeDispatchMode(false, true, true)).toBe<DispatchMode>('runtimeOptimistic');
    });

    it('a persisted entity always awaits the server, whatever its effect row', () => {
        expect(computeDispatchMode(false, false, false)).toBe<DispatchMode>('persistedAwaited');
        expect(computeDispatchMode(false, false, true)).toBe<DispatchMode>('persistedAwaited');
    });

    it('every DispatchMode value round-trips through the Zod schema', () => {
        const modes: DispatchMode[] = ['persistedAwaited', 'hybridClientOnly', 'runtimeOptimistic'];
        for (const mode of modes) {
            expect(DispatchModeSchema.safeParse(mode).success).toBe(true);
        }
        expect(DispatchModeSchema.safeParse('somethingElse').success).toBe(false);
    });
});

describe('computeTraitDispatchMode', () => {
    const runtimeEntity: Entity = { name: 'Session', persistence: 'runtime', fields: [] };
    const persistentEntity: Entity = { name: 'Order', persistence: 'persistent', fields: [] };
    const defaultPersistenceEntity: Entity = { name: 'Order', fields: [] };

    it('a local trait is hybridClientOnly regardless of the linked entity', () => {
        expect(computeTraitDispatchMode({ local: true }, runtimeEntity, true)).toBe<DispatchMode>('hybridClientOnly');
        expect(computeTraitDispatchMode({ local: true }, persistentEntity, true)).toBe<DispatchMode>('hybridClientOnly');
        expect(computeTraitDispatchMode({ local: true }, undefined, true)).toBe<DispatchMode>('hybridClientOnly');
    });

    it('a non-local trait on a [runtime] entity follows its effect row', () => {
        expect(computeTraitDispatchMode({ local: false }, runtimeEntity, false)).toBe<DispatchMode>('hybridClientOnly');
        expect(computeTraitDispatchMode({ local: false }, runtimeEntity, true)).toBe<DispatchMode>('runtimeOptimistic');
    });

    it('a non-local trait on a persistent entity is persistedAwaited', () => {
        expect(computeTraitDispatchMode({ local: false }, persistentEntity, false)).toBe<DispatchMode>('persistedAwaited');
        expect(computeTraitDispatchMode({ local: false }, defaultPersistenceEntity, true)).toBe<DispatchMode>('persistedAwaited');
    });

    it('an unresolved entity (undefined) is treated as not-runtime, matching Rust `None`', () => {
        expect(computeTraitDispatchMode({ local: false }, undefined, true)).toBe<DispatchMode>('persistedAwaited');
    });

    it('undeclared `local` (undefined) behaves like `local: false`', () => {
        expect(computeTraitDispatchMode({}, runtimeEntity, true)).toBe<DispatchMode>('runtimeOptimistic');
        expect(computeTraitDispatchMode({}, runtimeEntity, false)).toBe<DispatchMode>('hybridClientOnly');
        expect(computeTraitDispatchMode({}, undefined, false)).toBe<DispatchMode>('persistedAwaited');
    });
});
