import { describe, it, expect } from 'vitest';
import { applyListenPayloadMapping } from '../src/listen-payload-mapping';
import type { EventPayload, RuntimeValue, SExpr } from '../src/types/index';

/**
 * A faithful stand-in for the real evaluator's payload-only semantics
 * (`orbital-core/src/evaluator/operators/mod.rs:468` `eval_expr`, mirrored by
 * `@almadar/evaluator`'s `SExpressionEvaluator.evaluate`): `@payload.<field>`
 * resolves, any other bare string is a literal, object/array literals recurse,
 * and an operator list dispatches. Core cannot import `@almadar/evaluator`
 * (it sits upstream of it), so end-to-end parity against the REAL evaluator is
 * pinned in `@almadar/runtime`'s suite; this pins the helper's own contract.
 */
function evaluate(expr: SExpr, payload: EventPayload): RuntimeValue {
    if (typeof expr === 'string') {
        if (!expr.startsWith('@')) return expr;
        const path = expr.slice(1).split('.');
        if (path[0] !== 'payload') return undefined;
        let value: RuntimeValue = payload;
        for (const seg of path.slice(1)) {
            if (value === null || value === undefined || typeof value !== 'object') return undefined;
            value = (value as Record<string, RuntimeValue>)[seg];
        }
        return value;
    }
    if (Array.isArray(expr)) {
        const [op, ...args] = expr;
        if (op === 'object/get') {
            const target = evaluate(args[0], payload);
            const key = evaluate(args[1], payload);
            if (target === null || typeof target !== 'object' || typeof key !== 'string') return undefined;
            return (target as Record<string, RuntimeValue>)[key];
        }
        if (op === 'str/concat') return args.map((a) => String(evaluate(a, payload))).join('');
        if (op === 'boom') throw new Error('operator failed');
        if (op === 'make-fn') return () => 1;
        return expr.map((e) => evaluate(e, payload));
    }
    if (expr !== null && typeof expr === 'object') {
        const out: Record<string, RuntimeValue> = {};
        for (const [k, v] of Object.entries(expr)) out[k] = evaluate(v as SExpr, payload);
        return out;
    }
    return expr;
}

describe('applyListenPayloadMapping', () => {
    it('maps @payload.<field> references onto target fields', () => {
        expect(
            applyListenPayloadMapping(
                { searchTerm: '@payload.value' },
                { value: 'algebra' },
                evaluate,
            ),
        ).toEqual({ searchTerm: 'algebra' });
    });

    it('delivers non-@payload values as literals', () => {
        expect(
            applyListenPayloadMapping(
                { message: 'order shipped', id: '@payload.orderId' },
                { orderId: 'o-1' },
                evaluate,
            ),
        ).toEqual({ message: 'order shipped', id: 'o-1' });
    });

    it('drops unmapped source fields (the mapping replaces the payload)', () => {
        expect(
            applyListenPayloadMapping(
                { searchTerm: '@payload.value' },
                { value: 'x', extra: 'y' },
                evaluate,
            ),
        ).toEqual({ searchTerm: 'x' });
    });

    it('passes the payload through when there is no mapping', () => {
        const payload = { value: 'x' };
        expect(applyListenPayloadMapping(undefined, payload, evaluate)).toBe(payload);
    });

    it('passes undefined payload through untouched (mapping not applied)', () => {
        expect(
            applyListenPayloadMapping({ searchTerm: '@payload.value' }, undefined, evaluate),
        ).toBeUndefined();
    });

    it('maps a missing source field to undefined', () => {
        expect(
            applyListenPayloadMapping({ searchTerm: '@payload.value' }, { other: 1 }, evaluate),
        ).toEqual({ searchTerm: undefined });
    });

    describe('expression values (the `with { k: (op ...) }` surface)', () => {
        it('projects a field out of a carried context object', () => {
            expect(
                applyListenPayloadMapping(
                    {
                        candidate: '@payload.candidate',
                        accepted: ['object/get', '@payload.request', 'accepted'],
                        request: '@payload.request',
                    },
                    { candidate: 'mitosis', request: { accepted: ['mitosis', 'meiosis'] } },
                    evaluate,
                ),
            ).toEqual({
                candidate: 'mitosis',
                accepted: ['mitosis', 'meiosis'],
                request: { accepted: ['mitosis', 'meiosis'] },
            });
        });

        it('evaluates nested operator lists', () => {
            expect(
                applyListenPayloadMapping(
                    { query: ['str/concat', ['object/get', '@payload.request', 'candidate']] },
                    { request: { candidate: 42 } },
                    evaluate,
                ),
            ).toEqual({ query: '42' });
        });

        it('evaluates object and array literals', () => {
            expect(
                applyListenPayloadMapping(
                    { verdict: { status: 'mastered', mean: '@payload.mean' } },
                    { mean: 0.91 },
                    evaluate,
                ),
            ).toEqual({ verdict: { status: 'mastered', mean: 0.91 } });
        });

        it('carries non-string literals verbatim', () => {
            expect(
                applyListenPayloadMapping({ rung: 'R3', threshold: 0.85, force: true }, { a: 1 }, evaluate),
            ).toEqual({ rung: 'R3', threshold: 0.85, force: true });
        });
    });

    describe('parity with orbital-core listener fan-out', () => {
        it('drops a key whose expression throws, keeping the rest', () => {
            // `runtime/listener.rs:129` inserts only on `Ok(value)` — a failed
            // evaluation skips the key rather than delivering a hole.
            expect(
                applyListenPayloadMapping(
                    { good: '@payload.value', bad: ['boom'] },
                    { value: 'kept' },
                    evaluate,
                ),
            ).toEqual({ good: 'kept' });
        });

        it('drops a result that cannot travel in a payload', () => {
            // A function is not an `EventPayloadValue`; `isEventPayloadValue`
            // rejects it and the key is skipped rather than delivered.
            expect(
                applyListenPayloadMapping(
                    { fn: ['make-fn'], ok: '@payload.value' },
                    { value: 'kept' },
                    evaluate,
                ),
            ).toEqual({ ok: 'kept' });
        });
    });
});
