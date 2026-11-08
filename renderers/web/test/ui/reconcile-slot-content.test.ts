/**
 * reconcile-slot-content (R-SLOT-FLUSH-IDENTITY-CHURN).
 *
 * The slot flush sink rebuilds the descriptor tree on every render-ui flush;
 * reconciling against the existing entry keeps equal subtrees identity-stable
 * so the marker/trait-ref scan caches hit, and an all-equal flush lets the
 * sink bail the write entirely. Marker wrappers are re-minted per flush around
 * the SAME parsed-AST expression node — equality must compare through them.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { RENDER_BINDING_MARKER } from '@almadar/core';
import type { SExpr } from '@almadar/core';
import { reconcileSlotProps } from '../../src/lib/reconcile-slot-content';
import type { SlotProps, SlotPropValue } from '../../src/providers/UISlotContext';

function marker(expression: SExpr): SlotPropValue {
    return { [RENDER_BINDING_MARKER]: true, expression } as SlotPropValue;
}

describe('reconcileSlotProps', () => {
    it('returns equal + prev identity for a fully equal tree', () => {
        const expr = ['+', '@entity.x', 1] as SExpr;
        const prev: SlotProps = { title: 'hi', pos: marker(expr), items: [1, { a: 'x' }] };
        const next: SlotProps = { title: 'hi', pos: marker(expr), items: [1, { a: 'x' }] };
        const r = reconcileSlotProps(prev, next);
        expect(r.equal).toBe(true);
        expect(r.value).toBe(prev);
    });

    it('compares markers through their expression (fresh wrapper, same AST node)', () => {
        const expr = ['math/clamp', '@entity.body.x', 0, 10] as SExpr;
        const prev: SlotProps = { xMin: marker(expr) };
        const next: SlotProps = { xMin: marker(expr) };
        const r = reconcileSlotProps(prev, next);
        expect(r.equal).toBe(true);
        expect(r.value).toBe(prev);
    });

    it('markers with structurally equal but non-identical expressions are equal', () => {
        const prev: SlotProps = { xMin: marker(['+', '@entity.x', 1] as SExpr) };
        const next: SlotProps = { xMin: marker(['+', '@entity.x', 1] as SExpr) };
        const r = reconcileSlotProps(prev, next);
        expect(r.equal).toBe(true);
        expect(r.value).toBe(prev);
    });

    it('markers with different expressions are not equal', () => {
        const prev: SlotProps = { xMin: marker('@entity.x') };
        const next: SlotProps = { xMin: marker('@entity.y') };
        const r = reconcileSlotProps(prev, next);
        expect(r.equal).toBe(false);
        expect(r.value).not.toBe(prev);
        if (typeof r.value === 'string') throw new Error(`expected object props, got ${typeof r.value}`);
        expect(r.value.xMin).toBe(next.xMin);
    });

    it('changed literal leaf → not equal, but unchanged siblings keep identity', () => {
        const stats = [{ label: '★', value: 0 }];
        const prev: SlotProps = { title: 'a', stats, nested: { deep: [1, 2, { v: 'x' }] } };
        const next: SlotProps = { title: 'b', stats: [{ label: '★', value: 0 }], nested: { deep: [1, 2, { v: 'x' }] } };
        const r = reconcileSlotProps(prev, next);
        expect(r.equal).toBe(false);
        expect(r.value).not.toBe(prev);
        if (typeof r.value === 'string') throw new Error(`expected object props, got ${typeof r.value}`);
        expect(r.value.title).toBe('b');
        expect((r.value.stats as SlotPropValue[])).toHaveLength(1);
        // deep-equal subtrees are shared even inside a changed tree
        expect(r.value.nested).toBe(prev.nested);
        // arrays rebuild but their equal children keep identity
        const sharedStats = (r.value.stats as ReadonlyArray<SlotPropValue>)[0];
        expect(sharedStats).toBe(stats[0]);
    });

    it('Date leaves compare by time', () => {
        const d = new Date('2026-01-01');
        const prev: SlotProps = { at: d };
        const same: SlotProps = { at: new Date('2026-01-01') };
        const diff: SlotProps = { at: new Date('2026-01-02') };
        expect(reconcileSlotProps(prev, same).equal).toBe(true);
        expect(reconcileSlotProps(prev, diff).equal).toBe(false);
    });

    it('a React element rebuilt with the same type, key, ref and props is equal and keeps the previous element', () => {
        const prev = React.createElement('div', { key: 'k', title: 'a' }, React.createElement('span', null, 'x'));
        const next = React.createElement('div', { key: 'k', title: 'a' }, React.createElement('span', null, 'x'));
        const result = reconcileSlotProps({ c: prev }, { c: next });
        expect(result.equal).toBe(true);
        expect((result.value as { c: SlotPropValue }).c).toBe(prev);
    });

    it('control: a rebuilt element with another type, key, prop or callback is not equal', () => {
        const base = (): React.ReactElement => React.createElement('div', { key: 'k', title: 'a' });
        expect(reconcileSlotProps({ c: base() }, { c: React.createElement('section', { key: 'k', title: 'a' }) }).equal).toBe(false);
        expect(reconcileSlotProps({ c: base() }, { c: React.createElement('div', { key: 'j', title: 'a' }) }).equal).toBe(false);
        expect(reconcileSlotProps({ c: base() }, { c: React.createElement('div', { key: 'k', title: 'b' }) }).equal).toBe(false);
        const onClick = (): void => undefined;
        expect(reconcileSlotProps(
            { c: React.createElement('button', { onClick }) },
            { c: React.createElement('button', { onClick: (): void => undefined }) },
        ).equal).toBe(false);
    });

    it('functions compare by identity only', () => {
        const fn = (): void => undefined;
        expect(reconcileSlotProps({ f: fn as SlotPropValue }, { f: fn as SlotPropValue }).equal).toBe(true);
        expect(reconcileSlotProps({ f: fn as SlotPropValue }, { f: ((): void => undefined) as SlotPropValue }).equal).toBe(false);
    });

    it('key-set and length differences are not equal', () => {
        expect(reconcileSlotProps({ a: 1 }, { a: 1, b: 2 }).equal).toBe(false);
        expect(reconcileSlotProps({ l: [1, 2] }, { l: [1, 2, 3] }).equal).toBe(false);
    });

    it('type-mismatched containers are not equal', () => {
        expect(reconcileSlotProps({ v: [1] }, { v: { 0: 1 } }).equal).toBe(false);
        expect(reconcileSlotProps({ v: 'x' }, { v: marker('@entity.x') }).equal).toBe(false);
    });
});
