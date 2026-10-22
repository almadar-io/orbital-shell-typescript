import { describe, it, expect } from 'vitest';
import { renderUiEntriesOf } from '../src/patterns/helpers/render-ui-pattern-types';
import type { SExpr } from '../src/types/expression';

const card = { type: 'card', title: 'A' };

describe('renderUiEntriesOf', () => {
  it('finds a top-level render-ui', () => {
    expect(renderUiEntriesOf([['render-ui', 'main', card]])).toEqual([{ slot: 'main', pattern: card }]);
  });

  it('finds render-ui nested in when / if / do bodies, in order', () => {
    const effects: SExpr[] = [
      ['when', ['>', '@entity.count', 0], ['render-ui', 'main', { type: 'list' }]],
      ['if', '@entity.ok', ['render-ui', 'modal', { type: 'dialog' }], ['do', ['set', '@entity.x', 1], ['render-ui', 'toast', { type: 'alert' }]]],
    ];
    expect(renderUiEntriesOf(effects).map((e) => e.slot)).toEqual(['main', 'modal', 'toast']);
  });

  it('a null (clear-slot) render is not an entry', () => {
    expect(renderUiEntriesOf([['render-ui', 'modal', null], ['render-ui', 'main', card]])).toEqual([{ slot: 'main', pattern: card }]);
  });

  it('a pattern given as a binding string is not an entry', () => {
    expect(renderUiEntriesOf([['render-ui', 'main', '@config.view']])).toEqual([]);
  });

  it('keeps every slot a transition paints', () => {
    const entries = renderUiEntriesOf([['render-ui', 'main', card], ['render-ui', 'sidebar', { type: 'menu' }]]);
    expect(entries.map((e) => e.slot)).toEqual(['main', 'sidebar']);
  });

  it("never reads a pattern's own contents as effects", () => {
    const pattern = { type: 'button', action: 'GO', children: [['render-ui', 'main', { type: 'nested' }]] };
    expect(renderUiEntriesOf([['render-ui', 'main', pattern]])).toEqual([{ slot: 'main', pattern }]);
  });

  it('non-render effects yield nothing', () => {
    expect(renderUiEntriesOf([['set', '@entity.x', 1], ['emit', 'SAVED'], ['navigate', '/home']])).toEqual([]);
    expect(renderUiEntriesOf([])).toEqual([]);
  });

  it('reads let bodies and do bodies, never let bindings', () => {
    const effects: SExpr[] = [
      ['let', [['x', ['render-ui', 'main', { type: 'binding-not-effect' }]]], ['render-ui', 'main', { type: 'let-body' }]],
      ['do', ['render-ui', 'toast', { type: 'delayed' }]],
    ];
    expect(renderUiEntriesOf(effects).map((e) => e.pattern.type)).toEqual(['let-body', 'delayed']);
  });

  it('returns the schema objects themselves, so edits land in the schema', () => {
    const pattern = { type: 'card', title: 'A' };
    const [entry] = renderUiEntriesOf([['when', true, ['render-ui', 'main', pattern]]]);
    expect(entry.pattern).toBe(pattern);
  });
});
