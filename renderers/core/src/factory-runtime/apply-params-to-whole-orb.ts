/**
 * `applyParamsToWholeOrb` — pure runtime overlay for an ENTIRE stored orb.
 *
 * Companion to `applyParamsToOrb` (single-orbital). Applies the same overlay
 * to every orbital in the schema by joining each orbital to its matching
 * manifest entry from `manifests[]`. Returns a new `OrbitalSchema`.
 *
 * Reference: `docs/Almadar_Studio_SDK.md` §7.4.4.
 *
 * Pure data → data. No I/O.
 *
 * @packageDocumentation
 */

import type { OrbitalDefinition, OrbitalSchema } from '../types/index.js';
import type { OrbitalParamsManifest } from './manifest-types.js';
import type { OrbitalFactoryParams } from './types.js';
import { applyParamsToOrb } from './apply-params-to-orb.js';

export function applyParamsToWholeOrb(
  orb: OrbitalSchema,
  manifests: readonly OrbitalParamsManifest[],
  params: OrbitalFactoryParams,
): OrbitalSchema {
  const manifestByOrbital = new Map<string, OrbitalParamsManifest>();
  for (const m of manifests) {
    manifestByOrbital.set(m.orbitalName, m);
  }
  const rebuilt: OrbitalDefinition[] = [];
  for (const orbital of orb.orbitals) {
    const manifest = manifestByOrbital.get(orbital.name);
    if (!manifest) {
      rebuilt.push(orbital);
      continue;
    }
    rebuilt.push(applyParamsToOrb(orb, orbital.name, manifest, params));
  }
  return { ...orb, orbitals: rebuilt };
}
