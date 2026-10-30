/**
 * Declared inputs: the list, the addressing of a `listens` event onto one, and the payload checks are the kernel's
 * (`KernelEngine.externalInputs|findInputByAddress|payloadJsonSchema|payloadIssues`, `orbital-core`
 * `contract/payload_check.rs`).
 *
 * @packageDocumentation
 */

/**
 * An event written with `listens` addressing (`EVENT`, `Trait.EVENT`,
 * `Orbital.Trait.EVENT`) as a value. A service contract param of this type is
 * checked by `orb validate` against the program's declared external inputs.
 */
export type EventAddress = string;
