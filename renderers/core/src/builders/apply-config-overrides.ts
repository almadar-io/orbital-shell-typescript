/**
 * Apply trait config overrides to a schema — pure, returns a new schema.
 *
 * Used by config-driven preview surfaces (the playground property inspector and
 * the verify config-sweep) to render a behavior with different `config` values
 * WITHOUT recompiling: the override is written onto the matching trait, then the
 * schema is re-registered and re-rendered.
 *
 * The resolved schema's traits are inlined `Trait`s whose `config` is the
 * DECLARED schema (`{ field: { type, default, ... } }`), so an override patches
 * each field's `default`. A trait that instead carries call-site value config
 * (a `{ ref, config }` reference) gets the values merged directly.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from '../types/schema.js';
import type { TraitRef, TraitConfig, ConfigFieldDeclaration } from '../types/trait.js';
import { mergeCallSiteConfigOverrides } from '../types/trait.js';

function overrideTrait(trait: Exclude<TraitRef, string>, values: TraitConfig): Exclude<TraitRef, string> {
  // `scope` is required on a full `Trait`; the `{ ref, config }` reference has none.
  if ('scope' in trait) {
    // Inlined Trait: `config` is the DECLARED schema → patch each field's `default`.
    const config = trait.config;
    if (config === undefined) return trait;
    const next: Record<string, ConfigFieldDeclaration> = { ...config };
    for (const [field, value] of Object.entries(values)) {
      const decl = config[field];
      if (decl !== undefined) {
        next[field] = { ...decl, default: value };
      }
    }
    return { ...trait, config: next };
  }

  return { ...trait, config: mergeCallSiteConfigOverrides(trait.config ?? {}, values) };
}

function traitIdentity(trait: Exclude<TraitRef, string>): string | undefined {
  if (trait.name !== undefined) return trait.name;
  return 'ref' in trait ? trait.ref : undefined;
}

/**
 * Return a new schema with `config` overrides applied to traits whose identity
 * (`name`, falling back to `ref`) matches a key in `overrides`. Fields not
 * declared on the trait are ignored — overrides never invent config.
 */
export function applyTraitConfigOverrides(
  schema: OrbitalSchema,
  overrides: Readonly<Record<string, TraitConfig>>,
): OrbitalSchema {
  if (overrides === undefined || Object.keys(overrides).length === 0) return schema;
  return {
    ...schema,
    orbitals: schema.orbitals.map((orbital) => ({
      ...orbital,
      traits: orbital.traits.map((trait) => {
        if (typeof trait === 'string') return trait;
        const id = traitIdentity(trait);
        const values = id !== undefined ? overrides[id] : undefined;
        return values !== undefined ? overrideTrait(trait, values) : trait;
      }),
    })),
  };
}
