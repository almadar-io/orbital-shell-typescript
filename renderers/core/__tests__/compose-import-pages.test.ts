import { describe, it, expect } from 'vitest';
import { composeBehaviors } from '../src/builders/compose-behaviors';
import type { OrbitalDefinition } from '../src/types/orbital';

const importOrbital: OrbitalDefinition = {
  name: 'Faq',
  uses: [{ from: 'almadar-std/ui-accordion', as: 'Source' }],
  entity: 'Source.orbitals.AccordionOrbital.entity',
  traits: [],
  pages: [],
  reference: { ref: 'Source.orbitals.AccordionOrbital' },
};

const inlineOrbital: OrbitalDefinition = {
  name: 'Notes',
  entity: { name: 'Note', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
  traits: [],
  pages: [],
};

describe('composeBehaviors — pages of an orbital import', () => {
  it('generates no page for an import: its pages come whole from the imported orbital', () => {
    const { schema } = composeBehaviors({ appName: 'App', orbitals: [importOrbital, inlineOrbital], layoutStrategy: 'sidebar' });
    expect(schema.orbitals[0]?.pages).toEqual([]);
  });

  it('control: an inline orbital without pages still gets its generated page', () => {
    const { schema } = composeBehaviors({ appName: 'App', orbitals: [importOrbital, inlineOrbital], layoutStrategy: 'sidebar' });
    expect(schema.orbitals[1]?.pages).toEqual([{ name: 'NotesPage', path: '/notes', isInitial: false, primaryEntity: 'Note' }]);
  });
});
