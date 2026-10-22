/**
 * `extractManifest(orb)` — derive the typed `OrbitalParamsManifest[]` from a
 * resolved `.orb`, one entry per orbital.
 *
 * Pure data → data. No I/O. No behavior-specific branching.
 *
 * @packageDocumentation
 */

import type {
  DeclaredTraitConfig,
  EntityPersistence,
  OrbitalEntity,
  OrbitalSchema,
  TraitReference,
} from '../types/index.js';
import { persistenceModeAllowsOverrides } from '../types/index.js';
import { orbitalTouchesOwnRecord } from '../data-bearing.js';
import type { OrbitalParamsManifest, ParamFieldDescriptor } from './manifest-types.js';

const STATIC_PARAM_FIELDS: readonly ParamFieldDescriptor[] = [
  {
    name: 'fields',
    type: 'EntityField[]',
    description: 'Extra fields appended to the canonical entity.',
  },
  {
    name: 'pagePath',
    type: 'string',
    description: 'URL override for the orbital first page.',
  },
  {
    name: 'persistence',
    type: "'persistent' | 'runtime'",
    description: 'Override the canonical entity persistence mode.',
  },
  {
    name: 'entityName',
    type: 'string',
    description:
      "Rename the canonical entity. PascalCase singular, ≤32 chars. Threads through every trait's linkedEntity binding; compiler rewrites @Entity.x refs.",
  },
  {
    name: 'collection',
    type: 'string',
    description:
      'Override derived collection key. Defaults to plural(entityName).toLowerCase().',
  },
  {
    name: 'traitOverrides',
    type: 'Partial<Record<TraitName, { config?, linkedEntity?, events?, name?, emitsScope?, listens? }>>',
    description:
      ".lolo's native trait-composition surface 1:1: per-imported-trait config, linkedEntity, events, name, emitsScope, listens. effects is excluded (atom-owned; use listens via a sibling trait).",
  },
  {
    name: 'config',
    type: 'Readonly<Record<string, TraitConfigValue>>',
    description:
      "Override this orbital's own declared config knobs (Orbital.config) by key.",
  },
] as const;

interface SplitTraits {
  readonly refTraitNames: readonly string[];
  readonly inlineTraitNames: readonly string[];
}

function entityPersistence(
  entity: OrbitalSchema['orbitals'][number]['entity'],
): EntityPersistence | undefined {
  if (entity && typeof entity === 'object' && !('extends' in entity)) {
    return (entity as OrbitalEntity).persistence;
  }
  return undefined;
}

function declaredConfigKeys(config: DeclaredTraitConfig | undefined): readonly string[] | undefined {
  if (config === undefined) return undefined;
  const keys = Object.keys(config).sort();
  return keys.length > 0 ? keys : undefined;
}

/**
 * The param descriptors this orbital actually accepts — the closed L1 delta
 * allow-list, gated per orbital exactly like `persistence`/`collection`
 * (dropped when the entity's persistence mode disallows overrides): `config`
 * is dropped when the orbital declares no config knobs of its own.
 */
export function paramFieldsFor(
  _orb: OrbitalSchema,
  orbital: OrbitalSchema['orbitals'][number],
): readonly ParamFieldDescriptor[] {
  const allowPersistenceOverride = persistenceModeAllowsOverrides(entityPersistence(orbital.entity), orbitalTouchesOwnRecord(orbital));
  const hasConfig = declaredConfigKeys(orbital.config) !== undefined;
  return STATIC_PARAM_FIELDS.filter((f) => {
    if ((f.name === 'persistence' || f.name === 'collection') && !allowPersistenceOverride) {
      return false;
    }
    if (f.name === 'config' && !hasConfig) return false;
    return true;
  });
}

function splitTraits(traits: OrbitalSchema['orbitals'][number]['traits']): SplitTraits {
  const refTraitNames: string[] = [];
  const inlineTraitNames: string[] = [];
  for (const t of traits) {
    if (!t || typeof t !== 'object') continue;
    const tName = typeof (t as TraitReference).name === 'string'
      ? (t as TraitReference).name
      : null;
    if (!tName) continue;
    if (typeof (t as TraitReference).ref === 'string') {
      refTraitNames.push(tName);
    } else {
      inlineTraitNames.push(tName);
    }
  }
  return { refTraitNames, inlineTraitNames };
}

export function extractManifest(orb: OrbitalSchema): readonly OrbitalParamsManifest[] {
  const behaviorName = orb.name;
  return orb.orbitals.map((orbital) => {
    const { refTraitNames, inlineTraitNames } = splitTraits(orbital.traits);
    const configKeys = declaredConfigKeys(orbital.config);
    return {
      organism: behaviorName,
      orbitalName: orbital.name,
      paramFields: paramFieldsFor(orb, orbital),
      traitNames: refTraitNames,
      inlineTraitNames,
      ...(configKeys !== undefined ? { configKeys } : {}),
    };
  });
}
