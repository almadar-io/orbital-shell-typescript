import { describe, it, expect } from 'vitest';
import { orbitalImportFromValue, parseProgram } from '../src/builders';
import { applyOrbitalOverrides, type OrbitalValue } from '../src/types/behavior-value';

const tasks: OrbitalValue = {
  behavior: 'almadar-std/std-kanban',
  orbital: 'KanbanOrbital',
  name: 'Tasks',
  entity: 'Task',
  config: { pageSize: 20 },
  extend: [{ name: 'priority', type: 'string' }],
  traits: { KanbanBoard: { config: { compact: true }, events: { MOVE: 'SHIFT' } } },
};

describe('orbitalImportFromValue', () => {
  it('builds the §8b import orbital, wrapping plain config into the IR declaration form', () => {
    expect(orbitalImportFromValue(tasks)).toEqual({
      name: 'Tasks',
      uses: [{ from: 'almadar-std/std-kanban', as: 'Source' }],
      entity: 'Source.orbitals.KanbanOrbital.entity',
      traits: [],
      pages: [],
      reference: {
        ref: 'Source.orbitals.KanbanOrbital',
        entity: 'Task',
        extend: [{ name: 'priority', type: 'string' }],
        config: { pageSize: { type: 'unknown', default: 20 } },
        traits: { KanbanBoard: { config: { compact: { type: 'unknown', default: true } }, events: { MOVE: 'SHIFT' } } },
      },
    });
  });

  it('carries the source behavior\'s app knobs as the import\'s uses config', () => {
    const imported = orbitalImportFromValue({ behavior: 'almadar-behaviors/std-store-solution', orbital: 'ProductOrbital', app: { appName: 'Candles' } });
    expect(imported.uses).toEqual([{ from: 'almadar-behaviors/std-store-solution', as: 'Source', config: { appName: { type: 'unknown', default: 'Candles' } } }]);
    expect(imported.reference).toEqual({ ref: 'Source.orbitals.ProductOrbital' });
  });

  it('control: a bare value imports under its upstream name with an empty body', () => {
    expect(orbitalImportFromValue({ behavior: 'almadar-std/std-kanban', orbital: 'KanbanOrbital' })).toEqual({
      name: 'KanbanOrbital',
      uses: [{ from: 'almadar-std/std-kanban', as: 'Source' }],
      entity: 'Source.orbitals.KanbanOrbital.entity',
      traits: [],
      pages: [],
      reference: { ref: 'Source.orbitals.KanbanOrbital' },
    });
  });
});

describe('orbitalImportFromValue — sibling traits (the import\'s own uses + traits)', () => {
  const shelled: OrbitalValue = {
    behavior: 'almadar-behaviors/std-progress',
    orbital: 'ProgressOrbital',
    uses: [{ from: 'std/behaviors/std-app-layout', as: 'Shell' }],
    siblings: [{ name: 'ProgressShell', ref: 'Shell.traits.AppLayout', config: { navItems: '@pages', contentTrait: '@trait.ProgressList' } }],
    mounts: { '/progress': ['ProgressShell'] },
  };

  it('carries the value\'s own imports beside Source and its sibling traits into the import, config wrapped', () => {
    const imported = orbitalImportFromValue(shelled);
    expect(imported.uses).toEqual([
      { from: 'almadar-behaviors/std-progress', as: 'Source' },
      { from: 'std/behaviors/std-app-layout', as: 'Shell' },
    ]);
    expect(imported.traits).toEqual([
      { name: 'ProgressShell', ref: 'Shell.traits.AppLayout', config: { navItems: { type: 'unknown', default: '@pages' }, contentTrait: { type: 'unknown', default: '@trait.ProgressList' } } },
    ]);
    expect(imported.reference).toEqual({ ref: 'Source.orbitals.ProgressOrbital', mounts: { '/progress': ['ProgressShell'] } });
  });

  it('edge: an import aliased `Source` collides with the value\'s own source and is refused', () => {
    expect(() => orbitalImportFromValue({ ...shelled, uses: [{ from: 'std/behaviors/std-app-layout', as: 'Source' }] })).toThrow(/Source/);
  });

  it('control: behavior/apply merges uses by alias and siblings by name (config key-wise)', () => {
    const next = applyOrbitalOverrides(shelled, {
      uses: [{ from: 'std/behaviors/std-app-layout', as: 'Shell' }],
      siblings: [{ name: 'ProgressShell', ref: 'Shell.traits.AppLayout', config: { appName: 'Habits' } }],
    });
    expect(next.uses).toEqual([{ from: 'std/behaviors/std-app-layout', as: 'Shell' }]);
    expect(next.siblings).toEqual([{ name: 'ProgressShell', ref: 'Shell.traits.AppLayout', config: { navItems: '@pages', contentTrait: '@trait.ProgressList', appName: 'Habits' } }]);
  });
});

describe('parseProgram', () => {
  const inline = {
    name: 'Inline',
    entity: { name: 'Note', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [],
    pages: [],
  };

  it('turns orbital values into import orbitals and keeps inline orbitals in place, in order', () => {
    const program = parseProgram({ name: 'App', orbitals: [inline, { behavior: 'almadar-std/std-kanban', orbital: 'KanbanOrbital', name: 'Tasks' }] });
    expect(program.orbitals.map((o) => o.name)).toEqual(['Inline', 'Tasks']);
    expect(program.orbitals[1]?.reference?.ref).toBe('Source.orbitals.KanbanOrbital');
  });

  it('a program made only of orbital values parses', () => {
    const program = parseProgram({ name: 'App', orbitals: [{ behavior: 'almadar-std/std-kanban', orbital: 'KanbanOrbital' }] });
    expect(program.orbitals.map((o) => o.name)).toEqual(['KanbanOrbital']);
  });

  it('control: an orbital value with a key the import form lacks is refused', () => {
    expect(() => parseProgram({ name: 'App', orbitals: [{ behavior: 'almadar-std/std-kanban', orbital: 'KanbanOrbital', notAKey: 1 }] })).toThrow();
  });

  it('control: a program with no orbital values parses exactly as parseOrbitalSchema would', () => {
    expect(parseProgram({ name: 'App', orbitals: [inline] }).orbitals[0]?.name).toBe('Inline');
  });
});
