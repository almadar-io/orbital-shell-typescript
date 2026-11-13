/**
 * A wasm view whose call traps keeps its borrow held, so no later call may reach it; a returned error leaves it alive.
 */
import { describe, it, expect, vi } from 'vitest';
import { createViewGuard } from '../viewGuard';

describe('createViewGuard', () => {
    it('a call that traps kills the view: later calls never run', () => {
        const guard = createViewGuard();
        const onError = vi.fn();
        const result = guard.call(() => {
            throw new WebAssembly.RuntimeError('unreachable');
        }, onError);
        expect(result).toBeUndefined();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]?.[0]).toContain('unreachable');
        expect(guard.dead).toBe(true);
        const later = vi.fn(() => 1);
        expect(guard.call(later, onError)).toBeUndefined();
        expect(later).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('a call that throws an ordinary error leaves the view alive', () => {
        const guard = createViewGuard();
        const onError = vi.fn();
        expect(
            guard.call(() => {
                throw new Error('bad scene');
            }, onError),
        ).toBeUndefined();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(guard.dead).toBe(false);
        expect(guard.call(() => 7, onError)).toBe(7);
    });

    it('a healthy call returns its value', () => {
        const guard = createViewGuard();
        const onError = vi.fn();
        expect(guard.call(() => 'ok', onError)).toBe('ok');
        expect(onError).not.toHaveBeenCalled();
        expect(guard.dead).toBe(false);
    });
});
