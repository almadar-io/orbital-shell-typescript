import { describe, expect, it } from 'vitest';
import { HeldValues } from '../src/kernel/held-values.js';

const program = { name: 'crm', traits: [{ name: 'Deals' }] };
const render = (leaf: object) => JSON.stringify({ clientEffectsByTrait: [{ traitName: 'Viewer', effect: ['render-ui', 'main', { type: 'guest-view', program: leaf }] }] });
const programOf = (answer: { clientEffectsByTrait: Array<{ effect: [string, string, { program: object }] }> }) => answer.clientEffectsByTrait[0].effect[2].program;

describe('HeldValues (EXEC-DIST-16)', () => {
  it('reads a first send as its value and a later reference as the same object', () => {
    const held = new HeldValues();
    const first = programOf(held.read(render({ $held: 4, value: program })));
    expect(first).toEqual(program);
    const again = programOf(held.read(render({ $held: 4 })));
    expect(again).toBe(first);
    expect(held.size).toBe(1);
  });

  it('resolves a reference nested inside a first send', () => {
    const held = new HeldValues();
    held.read(render({ $held: 1, value: { list: [1, 2] } }));
    const outer = programOf(held.read(render({ $held: 2, value: { inner: { $held: 1 }, own: { $held: 3, value: ['x'] } } })));
    expect(outer).toEqual({ inner: { list: [1, 2] }, own: ['x'] });
    expect(programOf(held.read(render({ $held: 3 })))).toBe((outer as { own: object }).own);
  });

  it('drops the ids the kernel released', () => {
    const held = new HeldValues();
    held.read(render({ $held: 0, value: program }));
    held.release('[0]');
    expect(held.size).toBe(0);
    expect(() => held.read(render({ $held: 0 }))).toThrow('held value 0');
  });

  it('refuses a reference it was never handed, by id', () => {
    expect(() => new HeldValues().read(render({ $held: 9 }))).toThrow('held value 9');
  });

  it('control: an answer with no held leaf is read as plain JSON', () => {
    const held = new HeldValues();
    const text = render(program);
    expect(held.read(text)).toEqual(JSON.parse(text));
    expect(held.size).toBe(0);
  });

  it('control: a string that only spells the key is data, not a reference', () => {
    const held = new HeldValues();
    const answer = held.read(JSON.stringify({ note: '$held', list: ['"$held"'] }));
    expect(answer).toEqual({ note: '$held', list: ['"$held"'] });
  });

  it('keeps a held value from being changed through one of its readers', () => {
    const held = new HeldValues();
    const first = programOf(held.read(render({ $held: 0, value: program }))) as { name: string };
    expect(() => { first.name = 'changed'; }).toThrow();
  });
});
