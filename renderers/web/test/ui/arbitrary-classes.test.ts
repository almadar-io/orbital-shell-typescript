import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JsonObject, OrbitalSchema } from '@almadar/core';
import { arbitraryClassesOf, isArbitraryClass } from '../../src/lib/design-classes';

function schemaWith(render: JsonObject): OrbitalSchema {
  const json: JsonObject = {
    name: 'App',
    orbitals: [
      {
        name: 'Tasks',
        entity: { name: 'Task', fields: [] },
        traits: [
          {
            name: 'TaskFlow',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [{ key: 'INIT', name: 'INIT' }],
              transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', render]] }],
            },
          },
        ],
        pages: [{ name: 'TasksPage', path: '/tasks', traits: [{ ref: 'TaskFlow' }] }],
      },
    ],
  };
  return JSON.parse(JSON.stringify(json));
}

describe('arbitraryClassesOf', () => {
  it('collects arbitrary-value classes from every className, once, sorted', () => {
    const schema = schemaWith({
      type: 'stack',
      className: 'p-4 w-[243px]',
      children: [
        { type: 'button', className: 'bg-[#e14b2a] hover:bg-[#c43d20] rounded-lg' },
        { type: 'typography', className: 'w-[243px]' },
      ],
    });
    expect(arbitraryClassesOf(schema)).toEqual(['bg-[#e14b2a]', 'hover:bg-[#c43d20]', 'w-[243px]']);
  });

  it('finds classNames nested in pattern props, not only children', () => {
    const schema = schemaWith({ type: 'split', left: { type: 'box', className: 'min-h-[40vh]' } });
    expect(arbitraryClassesOf(schema)).toEqual(['min-h-[40vh]']);
  });

  it('scale and token classes are not arbitrary', () => {
    expect(arbitraryClassesOf(schemaWith({ type: 'box', className: 'p-4 w-60 bg-primary' }))).toEqual([]);
  });

  it('a className that is a binding expression contributes nothing', () => {
    expect(arbitraryClassesOf(schemaWith({ type: 'box', className: ['concat', 'w-[10px] ', '@entity.tone'] }))).toEqual([]);
  });
});

describe('arbitraryClassesOf — one walk per orbital, however many previews share it', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every preview schema built around the same orbital walks that orbital once', () => {
    const app = schemaWith({ type: 'box', className: 'w-[10px]' });
    const [orbital] = app.orbitals;
    const spy = vi.spyOn(JSON, 'stringify');
    const previews = Array.from({ length: 5 }, (_, i) => ({ ...app, name: `App__${i}`, orbitals: [orbital] }));
    for (const preview of previews) expect(arbitraryClassesOf(preview)).toEqual(['w-[10px]']);
    expect(spy.mock.calls.filter(([v]) => v === orbital)).toHaveLength(1);
  });

  it('control: an edited orbital is a new object and is walked again', () => {
    const app = schemaWith({ type: 'box', className: 'w-[10px]' });
    expect(arbitraryClassesOf(app)).toEqual(['w-[10px]']);
    const edited = schemaWith({ type: 'box', className: 'w-[11px]' });
    expect(arbitraryClassesOf({ ...app, orbitals: edited.orbitals })).toEqual(['w-[11px]']);
  });

  it('classes outside the orbitals (a custom pattern) still count', () => {
    const app = schemaWith({ type: 'box', className: 'w-[10px]' });
    const withCustom: OrbitalSchema = JSON.parse(JSON.stringify({ ...app, customPatterns: { hero: { type: 'box', className: 'h-[90vh]' } } }));
    expect(arbitraryClassesOf(withCustom)).toEqual(['h-[90vh]', 'w-[10px]']);
  });
});

describe('isArbitraryClass', () => {
  it('one class ending in a [value], variants allowed', () => {
    for (const c of ['w-[243px]', 'bg-[#e14b2a]', 'hover:bg-[#c43d20]', 'md:min-h-[40vh]', '-mt-[3px]']) expect(isArbitraryClass(c)).toBe(true);
  });

  it('scale classes, several classes, or junk are not', () => {
    for (const c of ['w-60', 'bg-primary', 'w-[1px] h-[2px]', 'foo', '[243px]', 'w-[]', '']) expect(isArbitraryClass(c)).toBe(false);
  });
});
