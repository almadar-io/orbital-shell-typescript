/**
 * A trait that arrives through an orbital import (`orbital X = A.orbitals.Y { … }`) is part of
 * what the orbital carries, but the import form cannot override it at the call site — so the
 * fill schema offers no `traitOverrides.<trait>` branch for it. Body traits keep theirs.
 */
import { describe, expect, it } from 'vitest';
import type { FactorySignature, FactoryTraitSignature } from '../index';
import { signatureToParamsSchema } from '../index';

const trait = (name: string, importedFrom?: string): FactoryTraitSignature => ({
  name,
  emittedEvents: [],
  listenedEvents: [],
  capabilities: [],
  overridableConfigKeys: [{ key: 'title', type: 'string', default: 'x' }],
  ...(importedFrom !== undefined ? { importedFrom } : {}),
});

const signature: FactorySignature = {
  organism: 'std-page',
  orbital: 'ClassesPage',
  tier: 'organisms',
  factoryPath: 'fake.ts',
  entities: [{ name: 'ClassSession', fields: [{ name: 'id', type: 'string', required: true }], persistence: 'persistent' }],
  traits: [trait('ClassesShell'), trait('ClassesPageMemberSchedule', 'Classes.orbitals.FitnessClassesOrbital')],
  pages: [],
  emittedEvents: [],
  listenedEvents: [],
};

const overrideKeys = (): string[] =>
  Object.keys(signatureToParamsSchema(signature).properties?.['traitOverrides']?.properties ?? {});

describe('signatureToParamsSchema — imported traits', () => {
  it('offers no override branch for a trait imported through an orbital import', () => {
    expect(overrideKeys()).not.toContain('ClassesPageMemberSchedule');
  });

  it('control: a body trait keeps its override branch', () => {
    expect(overrideKeys()).toContain('ClassesShell');
  });
});
