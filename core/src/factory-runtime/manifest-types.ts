/**
 * Orbital factory manifest types — shared across all packages.
 *
 * These types describe the param surface of a generated per-orbital factory.
 * Previously defined inline in each generated `dispatch.ts`; lifted to core so
 * `factory-runtime` can import them without a circular dep on generated code.
 *
 * @packageDocumentation
 */

export interface ParamFieldDescriptor {
  name: string;
  type: string;
  description: string;
}

export interface OrbitalParamsManifest {
  organism: string;
  orbitalName: string;
  paramFields: readonly ParamFieldDescriptor[];
  traitNames: readonly string[];
  inlineTraitNames: readonly string[];
  /**
   * The orbital's own declared config knob names (`Orbital.config`), the
   * `config` param's allow-list. Present only when the orbital declares at
   * least one knob of its own — mirrors `paramFields`' persistence-style
   * gate (see `extractManifest`). Absent means `config` is not a valid
   * top-level param for this orbital at all.
   */
  configKeys?: readonly string[];
}
