/**
 * ML contract validation — the ONE pure implementation shared by the runtime
 * path (`@almadar/evaluator`'s contract/* operators) and the compiled path
 * (the TypeScript shell imports `validateContract` directly, so the two
 * paths cannot drift). Mirrors `contract_helpers.py` (emitted by
 * `orbital-shell-python`) semantically: same contract JSON in, same
 * `{valid, violations}` out.
 *
 * A tensor on the JS side is a plain JSON value — a number, or (possibly
 * nested) arrays of numbers — exactly what a `torch.Tensor` round-trips
 * to/from via `tolist()`.
 *
 * @packageDocumentation
 */

/** A tensor on the JS path: a number, or nested arrays of numbers. */
export type TensorValue = number | TensorValue[];

/** Per-dimension range bound. Missing bounds default to +-Infinity, matching contract_helpers.py's `float("-inf")`/`float("inf")`. */
export interface ContractRange {
    min?: number;
    max?: number;
}

export interface ContractFieldSpec {
    name: string;
}

export type ContractFieldEntry = string | ContractFieldSpec;

/**
 * Canonical contract shape (matches contract_helpers.py's dict contracts
 * byte-for-byte): `shape`/`ranges` drive validate/clamp/violations, `fields`
 * drives the entity<->tensor mapping. A single contract object may carry
 * both halves.
 */
export interface ContractSpec {
    shape?: number[];
    ranges?: Record<string, ContractRange>;
    fields?: ContractFieldEntry[];
}

export interface ContractViolation {
    type: 'shape_mismatch' | 'range_violation' | 'not_a_tensor';
    expected?: number[];
    actual?: number[];
    dim?: number;
    min?: number;
    max?: number;
    actualMin?: number;
    actualMax?: number;
    /** `not_a_tensor` only — what arrived instead, for diagnosis. */
    actualType?: string;
}

export interface ContractValidationResult {
    valid: boolean;
    violations: ContractViolation[];
}

export function contractFieldName(f: ContractFieldEntry): string {
    return typeof f === 'string' ? f : f.name;
}

/**
 * A JS-path tensor is a number or nested arrays of numbers. Model output
 * arrives from an untrusted service, so every contract operator guards before
 * walking it — an unguarded walk throws a bare `TypeError` three frames deep,
 * which stalls the transition instead of abstaining.
 */
export function isTensorValue(v: unknown): v is TensorValue {
    if (typeof v === 'number') return true;
    return Array.isArray(v) && v.every(isTensorValue);
}

/** What arrived instead of a tensor, for the `not_a_tensor` violation. */
export function describeTensorMismatch(v: unknown): string {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array containing non-numeric values';
    return typeof v;
}

/** Shape of a tensor value, e.g. `[[1,2],[3,4]]` -> `[2,2]`, `[1,2,3]` -> `[3]`. */
export function tensorShape(t: TensorValue): number[] {
    if (typeof t === 'number') return [];
    if (t.length === 0) return [0];
    const first = t[0];
    if (typeof first === 'number') return [t.length];
    return [t.length, ...tensorShape(first)];
}

export function tensorLastDimSize(t: TensorValue): number {
    const shape = tensorShape(t);
    return shape.length === 0 ? 0 : shape[shape.length - 1];
}

function arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** All values at index `dim` along the last axis, flattened across every leading axis — mirrors `tensor[..., dim]`. */
export function gatherTensorLastDim(t: TensorValue, dim: number): number[] {
    if (typeof t === 'number') return [];
    if (t.length === 0) return [];
    if (typeof t[0] === 'number') return [(t as number[])[dim]];
    const out: number[] = [];
    for (const sub of t) out.push(...gatherTensorLastDim(sub, dim));
    return out;
}

/** Replace values at index `dim` along the last axis via `fn` — mirrors in-place `result[..., dim] = ...clamp(...)`. */
export function mapTensorLastDim(t: TensorValue, dim: number, fn: (v: number) => number): TensorValue {
    if (typeof t === 'number') return t;
    if (t.length === 0) return t;
    if (typeof t[0] === 'number') {
        const copy = [...(t as number[])];
        copy[dim] = fn(copy[dim]);
        return copy;
    }
    return t.map((sub) => mapTensorLastDim(sub, dim, fn));
}

export function validateContract(tensor: unknown, contract: ContractSpec): ContractValidationResult {
    if (!isTensorValue(tensor)) {
        return {
            valid: false,
            violations: [{ type: 'not_a_tensor', actualType: describeTensorMismatch(tensor) }],
        };
    }
    const violations: ContractViolation[] = [];
    const shape = tensorShape(tensor);

    if (contract.shape && !arraysEqual(shape, contract.shape)) {
        violations.push({ type: 'shape_mismatch', expected: contract.shape, actual: shape });
    }

    const ranges = contract.ranges ?? {};
    const size = tensorLastDimSize(tensor);
    for (const [dimStr, bounds] of Object.entries(ranges)) {
        const dim = Number(dimStr);
        if (dim >= size) continue; // out-of-range dim indices are silently skipped, matching contract_validate_input
        const vals = gatherTensorLastDim(tensor, dim);
        const min = bounds.min ?? -Infinity;
        const max = bounds.max ?? Infinity;
        const actualMin = Math.min(...vals);
        const actualMax = Math.max(...vals);
        if (actualMin < min || actualMax > max) {
            violations.push({ type: 'range_violation', dim, min, max, actualMin, actualMax });
        }
    }

    return { valid: violations.length === 0, violations };
}
