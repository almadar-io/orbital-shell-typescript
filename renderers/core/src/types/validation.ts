/**
 * Validation error types — the shape emitted by every
 * `.orb` / `.lolo` validator pass.
 *
 * `ValidationError` is the wire shape: `{ code, path, message, suggestion? }`.
 * `code` is `ValidationErrorCode`, which is an OPEN `string` to let the
 * Rust validator emit new codes without an `@almadar/core` rev. The
 * `KNOWN_VALIDATION_ERROR_CODES` const documents the codes currently
 * emitted by the validator + lolo lower pipeline (extracted from
 * `orbital-rust/crates/orbital-compiler/src/phases/validation/` +
 * `orbital-rust/crates/orbital-lolo/src/`).
 *
 * Consumers that want to narrow a code to the closed known set use
 * `KnownValidationErrorCode`:
 *
 * ```ts
 * if (err.code in KNOWN_VALIDATION_ERROR_CODES) {
 *   // err.code is now narrowable to KnownValidationErrorCode for
 *   // exhaustive switch handling.
 * }
 * ```
 *
 * @packageDocumentation
 */

import validationCodesJson from '../generated/language/validation-codes.json' with { type: 'json' };

interface ValidationCodeEntry {
  code: string;
  category: string;
  description: string;
}

const validationCodes: readonly ValidationCodeEntry[] = validationCodesJson;

/**
 * One validation diagnostic emitted by the validator / lolo lower pipeline.
 *
 * - `code`: machine-readable identifier (see `KNOWN_VALIDATION_ERROR_CODES`).
 * - `path`: JSON pointer-like path into the failing schema location,
 *   e.g. `'orbitals[0].traits[2].stateMachine.transitions[1].effects[0]'`.
 * - `message`: human-readable description of the failure.
 * - `suggestion`: optional hint the validator may add to help the
 *   author / LLM fix the issue.
 */
export interface ValidationError {
  code: ValidationErrorCode;
  path: string;
  message: string;
  suggestion?: string;
}

/**
 * Validation error code — open `string` for forward-compat with the
 * Rust validator's evolving code set. Narrow to the closed known set
 * via `KnownValidationErrorCode` when exhaustive handling is needed.
 */
export type ValidationErrorCode = string;

const ORBITAL_PATH_PREFIX = /^orbitals\[(\d+)(?: \([^\]]*\))?\]/;

/**
 * The index of the orbital a validation error belongs to, read from the
 * validator's declared path shape `orbitals[<index> (<name>)]…`, split into
 * segments or not (`['orbitals[<index> (<name>)]', …]`, `['orbitals', <index>, …]`);
 * null for a schema-level (or missing) path.
 */
export function orbitalIndexOfValidationPath(path: string | ReadonlyArray<string | number> | undefined): number | null {
  if (Array.isArray(path)) {
    if (path[0] === 'orbitals') return typeof path[1] === 'number' ? path[1] : null;
    return typeof path[0] === 'string' ? orbitalIndexOfValidationPath(path[0]) : null;
  }
  const m = typeof path === 'string' ? ORBITAL_PATH_PREFIX.exec(path) : null;
  return m ? Number(m[1]) : null;
}

/**
 * The result of a single validator pass: a boolean verdict plus the errors
 * and warnings (the validator wire shape, `ValidationError`).
 *
 * Distinct from `ValidationResults` (app.ts): that is the Firestore-persisted
 * app-document shape keyed on `ValidationIssue` (with `severity` + array path
 * + `validatedAt`). This `ValidationResult` is the in-process pass result keyed
 * on `ValidationError` (code + JSON-pointer string path + `suggestion`).
 * `ok === true` iff there are zero errors AND zero warnings.
 */
export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Closed set of validation codes the Rust validator + lolo lower
 * pipeline emit, derived from the generated
 * `generated/language/validation-codes.json` (orbital-compiler
 * `ErrorCode::ALL`). Never hand-listed here.
 *
 * Categories (prefix → meaning):
 * - `ORB_BINDING_*` — binding (`@entity.X`, `@payload.Y`, ...) issues
 * - `ORB_E_*` / `ORB_EFF_*` / `ORB_EMIT_*` — entity / effect / emit
 * - `ORB_GEN_*` — generic / cross-cutting structure
 * - `ORB_O_*` / `ORB_P_*` / `ORB_S_*` / `ORB_SM_*` / `ORB_T_*` —
 *   orbital / page / schema / state-machine / trait
 * - `ORB_QUERY_*` — query / search behaviors
 * - `ORB_RUI_*` — render-UI binding + prop validation
 * - `ORB_SLOT_*` — UI-slot conflict / contention
 * - `ORB_SVC_*` / `ORB_UI_*` — service / UI primitives
 * - `ORB_X_*` — cross-orbital constraints (listens, emits, IDs)
 * - `ORB_ID_*` — V4 dual-carry id integrity (unknown ref, name/kind
 *   mismatch, ledger orphan)
 */
export const KNOWN_VALIDATION_ERROR_CODES: Readonly<Record<string, string>> = Object.fromEntries(
  validationCodes.map((entry) => [entry.code, entry.code]),
);

/**
 * Narrow union of the codes documented in `KNOWN_VALIDATION_ERROR_CODES`.
 * Use this in exhaustive `switch` handlers; use the broader
 * `ValidationErrorCode` (open `string`) anywhere a fresh validator-side
 * code could plausibly arrive.
 */
export type KnownValidationErrorCode = string;

/**
 * Type guard: is the given code a known one? After the guard returns
 * true, the code can be narrowed to `KnownValidationErrorCode` via a
 * separate cast, because the type system can't track `in` against
 * `as const` records without an explicit narrowing helper.
 */
export function isKnownValidationErrorCode(
  code: ValidationErrorCode,
): boolean {
  return code in KNOWN_VALIDATION_ERROR_CODES;
}
