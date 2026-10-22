/**
 * `readableEntitiesOf` — the entities a `call-service` provider acting as the
 * caller may read: every persisted entity of the program, once, in schema order.
 * The compiled host's `ENTITY_READS` table is built by the same rule
 * (`orbital-shell-typescript` `orbital_route.rs`), so both paths offer the same
 * read tool. Row visibility stays with each entity's `@read` policy.
 */

import { describe, it, expect } from 'vitest';
import { readableEntitiesOf, type OrbitalDefinition, type OrbitalSchema } from '../index';

function orbital(name: string, entity: OrbitalDefinition['entity'], auxiliaryEntities?: OrbitalDefinition['auxiliaryEntities']): OrbitalDefinition {
  return { name, entity, ...(auxiliaryEntities ? { auxiliaryEntities } : {}), traits: [], pages: [] };
}

const id = [{ name: 'id', type: 'string' as const, required: true }];

describe('readableEntitiesOf', () => {
  it('lists every persisted entity, primary and auxiliary, in schema order', () => {
    const schema: OrbitalSchema = {
      name: 'App',
      orbitals: [
        orbital('TaskOrbital', { name: 'Task', collection: 'tasks', persistence: 'persistent', fields: id }, [
          { name: 'Comment', collection: 'comments', persistence: 'persistent', fields: id },
        ]),
        orbital('ProjectOrbital', { name: 'Project', collection: 'projects', persistence: 'persistent', fields: id }),
      ],
    };
    expect(readableEntitiesOf(schema)).toEqual(['Task', 'Comment', 'Project']);
  });

  it('control: runtime entities hold no rows and are not readable', () => {
    const schema: OrbitalSchema = {
      name: 'App',
      orbitals: [
        orbital('PanelOrbital', { name: 'PanelState', persistence: 'runtime', fields: id }),
        orbital('TaskOrbital', { name: 'Task', collection: 'tasks', persistence: 'persistent', fields: id }),
      ],
    };
    expect(readableEntitiesOf(schema)).toEqual(['Task']);
  });

  it('edge: an entity shared by two orbitals is listed once', () => {
    const task = { name: 'Task', collection: 'tasks', persistence: 'persistent' as const, fields: id };
    const schema: OrbitalSchema = { name: 'App', orbitals: [orbital('BoardOrbital', task), orbital('ListOrbital', task)] };
    expect(readableEntitiesOf(schema)).toEqual(['Task']);
  });

  it('edge: an unresolved entity reference is skipped, and an empty program reads nothing', () => {
    expect(readableEntitiesOf({ name: 'App', orbitals: [orbital('RefOrbital', 'Task')] })).toEqual([]);
    expect(readableEntitiesOf({ name: 'App', orbitals: [] })).toEqual([]);
  });
});
