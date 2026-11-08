// @vitest-environment jsdom
/**
 * R-SLOT-FLUSH-IDENTITY-CHURN — the flush sink must preserve identity.
 *
 * A tick-rate `render-ui` re-flush of the same descriptor rebuilds the props
 * tree but changes nothing (every `@entity` leaf arrives as a marker around
 * the SAME parsed-AST node). Before the sink reconciled, each flush stored an
 * all-new tree: every downstream memo busted, the marker/trait-ref scan
 * WeakMaps missed on every container, and React re-reconciled the whole slot
 * subtree per flush. Now an all-equal flush bails the state write entirely,
 * and a partially-changed flush shares every unchanged subtree.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { RENDER_BINDING_MARKER } from '@almadar/core';
import type { SExpr } from '@almadar/core';
import { useUISlotManager } from '../../src/hooks/useUISlots';
import type { SlotProps, SlotPropValue } from '../../src/providers/UISlotContext';

function descriptor(score: string): SlotProps {
    const expr = '@entity.score' as SExpr;
    return {
        appName: 'riya · The Open Line',
        children: [
            {
                type: 'math-canvas',
                xMin: { [RENDER_BINDING_MARKER]: true, expression: expr } as SlotPropValue,
                points: [{ x: 1, y: 2, label: 'riya' }],
                note: score,
            },
        ],
    } as SlotProps;
}

describe('useUISlots flush sink — structural sharing', () => {
    it('an all-equal re-flush bails: slot state identity unchanged', () => {
        const { result } = renderHook(() => useUISlotManager());

        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        const first = result.current.slots['main'];

        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        expect(result.current.slots['main']).toBe(first);
    });

    it('a changed flush stores new content but shares unchanged subtrees', () => {
        const { result } = renderHook(() => useUISlotManager());

        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        const first = result.current.slots['main'];

        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('b') });
        });
        const second = result.current.slots['main'];
        expect(second).not.toBe(first);
        expect(second?.pattern).toBe('game-shell');
        // The marker subtree inside was untouched by the change — identity kept.
        const firstProps = first?.props;
        const secondProps = second?.props;
        if (typeof firstProps === 'string' || firstProps === undefined) throw new Error(`expected object props, got ${typeof firstProps}`);
        if (typeof secondProps === 'string' || secondProps === undefined) throw new Error(`expected object props, got ${typeof secondProps}`);
        const firstChildren = firstProps.children as ReadonlyArray<{ xMin: SlotPropValue }>;
        const secondChildren = secondProps.children as ReadonlyArray<{ xMin: SlotPropValue }>;
        expect(secondChildren[0].xMin).toBe(firstChildren[0].xMin);
    });

    it('a different pattern never bails', () => {
        const { result } = renderHook(() => useUISlotManager());

        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        const first = result.current.slots['main'];
        act(() => {
            result.current.render({ target: 'main', pattern: 'stack', sourceTrait: 'World', props: descriptor('a') });
        });
        expect(result.current.slots['main']).not.toBe(first);
        expect(result.current.slots['main']?.pattern).toBe('stack');
    });
});

describe('useUISlots embedded trait content — structural sharing', () => {
    it('an all-equal re-write of an embedded trait notifies no subscriber', () => {
        const { result } = renderHook(() => useUISlotManager());
        let notified = 0;
        act(() => {
            result.current.subscribeTrait('Child', () => { notified += 1; });
            result.current.updateTraitContent('Child', { pattern: 'stack', props: descriptor('a'), slot: 'main', priority: 0 });
        });
        const first = result.current.getTraitContent('Child');
        expect(notified).toBe(1);
        act(() => {
            result.current.updateTraitContent('Child', { pattern: 'stack', props: descriptor('a'), slot: 'main', priority: 0 });
        });
        expect(notified).toBe(1);
        expect(result.current.getTraitContent('Child')).toBe(first);
    });

    it('control: a changed embedded write notifies with the new content', () => {
        const { result } = renderHook(() => useUISlotManager());
        let notified = 0;
        act(() => {
            result.current.subscribeTrait('Child', () => { notified += 1; });
            result.current.updateTraitContent('Child', { pattern: 'stack', props: descriptor('a'), slot: 'main', priority: 0 });
            result.current.updateTraitContent('Child', { pattern: 'stack', props: descriptor('b'), slot: 'main', priority: 0 });
        });
        expect(notified).toBe(2);
        const props = result.current.getTraitContent('Child')?.props;
        if (typeof props === 'string' || props === undefined) throw new Error(`expected object props, got ${typeof props}`);
        expect((props.children as ReadonlyArray<{ note: string }>)[0].note).toBe('b');
    });
});

describe('useUISlots flush sink — an identical write schedules nothing', () => {
    it('re-writing the same content does not re-render the slot manager', () => {
        let renders = 0;
        const { result } = renderHook(() => { renders += 1; return useUISlotManager(); });
        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        const settled = renders;
        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        expect(renders).toBe(settled);
    });

    it('control: A, then B, then A again ends on A', () => {
        const { result } = renderHook(() => useUISlotManager());
        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('b') });
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        const props = result.current.slots['main']?.props;
        if (typeof props === 'string' || props === undefined) throw new Error(`expected object props, got ${typeof props}`);
        expect((props.children as ReadonlyArray<{ note: string }>)[0].note).toBe('a');
    });

    it('control: the same content written after its source was cleared is shown again', () => {
        const { result } = renderHook(() => useUISlotManager());
        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        act(() => { result.current.clearBySource('main', 'World'); });
        expect(result.current.slots['main']).toBeNull();
        act(() => {
            result.current.render({ target: 'main', pattern: 'game-shell', sourceTrait: 'World', props: descriptor('a') });
        });
        expect(result.current.slots['main']?.pattern).toBe('game-shell');
    });
});
