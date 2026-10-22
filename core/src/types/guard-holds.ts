/**
 * Whether a guard holds. A guard that throws does not hold: it blocks its transition exactly
 * like a false guard, and the error is handed to `onError` (one rule on every path — the JS
 * runtime, the code the TypeScript shell generates, and the Rust kernel).
 */
export function guardHolds(check: () => boolean, onError: (error: Error) => void): boolean {
  try {
    return check();
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}
