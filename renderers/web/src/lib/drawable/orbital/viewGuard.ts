/**
 * Calls into one WebAssembly view. A call that traps (a renderer panic) leaves the view's borrow held, so the view is
 * dead: no later call reaches it, `free` included.
 */
export interface ViewGuard {
    /** Whether a call trapped. */
    readonly dead: boolean;
    /** Run one call on the view; `undefined` when the view is dead or the call threw, after `onError` heard why. */
    call<T>(run: () => T, onError: (message: string) => void): T | undefined;
}

export function createViewGuard(): ViewGuard {
    let dead = false;
    return {
        get dead() {
            return dead;
        },
        call(run, onError) {
            if (dead) return undefined;
            try {
                return run();
            } catch (cause) {
                if (cause instanceof WebAssembly.RuntimeError) dead = true;
                onError(String(cause));
                return undefined;
            }
        },
    };
}
