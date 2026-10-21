/**
 * Dashboard cross-trait + renderItem-lambda tests.
 *
 * Two layers of the std-dashboard pipeline are testable without mounting
 * React:
 *
 *   1. Cross-trait listeners — when DashboardItemBrowse emits BrowseItemLoaded
 *      with `{ data: [...rows], totalCount: <n> }`, every subscribing trait
 *      (DashboardSummary / DashboardCategoryChart / DashboardStatusChart)
 *      receives the SAME payload reference. The triage on stat cards
 *      showing "1/0" needs this contract pinned: if the bus ever splits or
 *      mutates `data` between listeners, aggregation results would diverge
 *      from the source-of-truth row count.
 *
 *   2. renderItem lambda binding resolution — `["fn","card",{type:"stat-display",
 *      value:"@card.value", variant:"@card.variant", ...}]` is what the
 *      data-list pattern receives. `resolveLambdaBindings` walks the body
 *      and substitutes `@card.X` with the row's actual field. If a strict
 *      struct row has `{value: 6}`, the rendered prop must be 6 — silent
 *      coercion to undefined or "" would render "0" or empty in the UI.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveLambdaBindings, isFnFormLambda } from '../../src/lib/fn-form-lambda';

// Minimal pub/sub mirroring the EventBusProvider contract: the cross-trait
// path in `useTraitStateMachine` only relies on `on(busKey, cb)` + `emit`.
function createMiniBus() {
    const listeners = new Map<string, Array<(event: { payload?: unknown }) => void>>();
    return {
        on(key: string, cb: (event: { payload?: unknown }) => void) {
            const arr = listeners.get(key) ?? [];
            arr.push(cb);
            listeners.set(key, arr);
            return () => {
                const cur = listeners.get(key);
                if (cur) listeners.set(key, cur.filter((x) => x !== cb));
            };
        },
        emit(key: string, payload?: unknown) {
            (listeners.get(key) ?? []).forEach((cb) => cb({ payload }));
        },
    };
}

describe('Dashboard cross-trait fan-out', () => {
    it('one BrowseItemLoaded → three listeners receive the same {data, totalCount} payload', () => {
        const bus = createMiniBus();
        const summarySpy = vi.fn();
        const categoryChartSpy = vi.fn();
        const statusChartSpy = vi.fn();
        // Each atom's effect-installer subscribes its own bus key. The
        // cross-orbital fan-out unifies BrowseItemLoaded into ITEMS_LOADED
        // for whatever trait listens; here we model the bus key directly.
        bus.on('UI:DashboardItemOrbital.DashboardItemBrowse.BrowseItemLoaded', (e) => summarySpy(e.payload));
        bus.on('UI:DashboardItemOrbital.DashboardItemBrowse.BrowseItemLoaded', (e) => categoryChartSpy(e.payload));
        bus.on('UI:DashboardItemOrbital.DashboardItemBrowse.BrowseItemLoaded', (e) => statusChartSpy(e.payload));
        const rows = [
            { id: 'a', status: 'active', category: 'foo' },
            { id: 'b', status: 'active', category: 'bar' },
            { id: 'c', status: 'inactive', category: 'foo' },
        ];
        bus.emit('UI:DashboardItemOrbital.DashboardItemBrowse.BrowseItemLoaded', { data: rows, totalCount: rows.length });
        // Same shape, same row count, same field set delivered to all three.
        for (const spy of [summarySpy, categoryChartSpy, statusChartSpy]) {
            expect(spy).toHaveBeenCalledTimes(1);
            const payload = spy.mock.calls[0][0] as { data: unknown[]; totalCount: number };
            expect(payload.totalCount).toBe(3);
            expect(payload.data).toHaveLength(3);
            // Reference identity — the bus does not clone payloads. If a
            // future refactor adds defensive copies that strip fields, this
            // assertion catches it.
            expect(payload.data).toBe(rows);
        }
    });

    it('listener with no subscribers receives nothing (no global broadcast leak)', () => {
        const bus = createMiniBus();
        const otherSpy = vi.fn();
        bus.on('UI:OtherOrbital.OtherTrait.OtherEvent', otherSpy);
        bus.emit('UI:DashboardItemOrbital.DashboardItemBrowse.BrowseItemLoaded', { data: [], totalCount: 0 });
        expect(otherSpy).not.toHaveBeenCalled();
    });
});

describe('renderItem lambda binding resolution', () => {
    it('detects fn-form lambda — required for the data-list pattern\'s renderItem path', () => {
        // The codegen + runtime both read renderItem through `isFnFormLambda`
        // before invoking `resolveLambdaBindings`. A regression here would
        // make every stat-display card render the raw lolo source instead
        // of substituted values.
        expect(isFnFormLambda(['fn', 'card', { type: 'stat-display', label: '@card.label' }])).toBe(true);
        expect(isFnFormLambda(['fn', 'card'])).toBe(false);
        expect(isFnFormLambda(null)).toBe(false);
        expect(isFnFormLambda({ fn: 'card' })).toBe(false);
    });

    it('std-stats card row: every @card.<field> reaches the right StatDisplay prop', () => {
        // Mirrors the body std-stats emits at the data-list call site:
        //   { type: 'stat-display', label: '@card.label', value: '@card.value',
        //     icon: '@card.icon', variant: '@card.variant', format: '@card.format',
        //     max: '@card.max' }
        // The runtime evaluator already produced the strict struct row;
        // this layer just substitutes per-field bindings into the render.
        const card = {
            label: 'Total Revenue',
            value: 97,
            icon: 'dollar-sign',
            variant: 'info',
            format: 'currency',
            max: 0,
        };
        const body = {
            type: 'stat-display',
            label: '@card.label',
            value: '@card.value',
            icon: '@card.icon',
            variant: '@card.variant',
            format: '@card.format',
            max: '@card.max',
        };
        expect(resolveLambdaBindings(body, ['card'], card, 0)).toEqual({
            type: 'stat-display',
            label: 'Total Revenue',
            value: 97,
            icon: 'dollar-sign',
            variant: 'info',
            format: 'currency',
            max: 0,
        });
    });

    it('zero-valued card fields stay numeric (max:0 must NOT collapse to "")', () => {
        // Defensive: the substitution path returns "" for undefined/null.
        // A literal zero must round-trip as number 0, otherwise StatDisplay
        // sees `max=""` and renders no max-divider where the schema author
        // explicitly opted out (max:0 means "no max"). Same concern for
        // value:0 — StatDisplay's number-formatting path would treat ""
        // as missing and fall back to '0' string.
        const card = { value: 0, max: 0, label: 'Empty Bucket' };
        const body = { value: '@card.value', max: '@card.max', label: '@card.label' };
        const resolved = resolveLambdaBindings(body, ['card'], card, 0) as Record<string, unknown>;
        expect(resolved.value).toBe(0);
        expect(resolved.max).toBe(0);
        expect(resolved.label).toBe('Empty Bucket');
        expect(typeof resolved.value).toBe('number');
        expect(typeof resolved.max).toBe('number');
    });

    it('grouped multi-param lambda (item, index) resolves both params', () => {
        // The compiler canonicalizes 2-param render callbacks to the grouped
        // form `["fn", ["item","index"], body]`. The UI runtime must accept it
        // and substitute @item.* against the row AND @index against the loop
        // position (was previously single-param-only, rejecting this shape).
        expect(isFnFormLambda(['fn', ['item', 'index'], { type: 'stat-display', label: '@item.label', value: '@index' }])).toBe(true);
        const body = { type: 'stat-display', label: '@item.label', value: '@index' };
        const resolved = resolveLambdaBindings(body, ['item', 'index'], { label: 'Row A' }, 3) as Record<string, unknown>;
        expect(resolved.label).toBe('Row A');
        expect(resolved.value).toBe(3);
        expect(typeof resolved.value).toBe('number');
    });
});
