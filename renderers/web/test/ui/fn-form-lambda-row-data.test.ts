/**
 * Row data substituted into a lambda body is data, never code: an array whose head names an operator, an object holding
 * one, or a string shaped like a binding must reach the rendered props as the row holds it. The twin of orbital-core's
 * `resolve_value` rule (`test_resolve_value_runtime_data_is_never_evaluated_as_code`).
 */
import { describe, it, expect } from 'vitest';
import { resolveLambdaBindings } from '../../src/lib/fn-form-lambda';

describe('resolveLambdaBindings keeps row data as data', () => {
  it('an operator-shaped array from the row is passed through, not called', () => {
    const out = resolveLambdaBindings({ type: 'tag-list', tags: '@item.tags' }, ['item'], { id: 'r1', tags: ['list', '-c', 'x'] }, 0);
    expect(out).toEqual({ type: 'tag-list', tags: ['list', '-c', 'x'] });
  });

  it('an operator-shaped array from the row is an argument value inside an authored call', () => {
    const out = resolveLambdaBindings({ type: 'typography', content: ['array/len', '@item.tags'] }, ['item'], { id: 'r1', tags: ['list', 'a', 'b'] }, 0);
    expect(out).toEqual({ type: 'typography', content: 3 });
  });

  it('a whole row holding an operator-shaped field is data', () => {
    const row = { id: 'r1', form: ['if', true, 'yes', 'no'] };
    const out = resolveLambdaBindings({ type: 'card', row: '@item' }, ['item'], row, 0);
    expect(out).toEqual({ type: 'card', row });
  });

  it('a row string shaped like a binding stays the row text', () => {
    const out = resolveLambdaBindings({ type: 'typography', content: '@item.name' }, ['item'], { id: 'r1', name: '@entity.secret' }, 0);
    expect(out).toEqual({ type: 'typography', content: '@entity.secret' });
  });

  it('control: an authored call over row values still evaluates', () => {
    const out = resolveLambdaBindings({ type: 'typography', content: ['str/concat', '⚔', '@item.attack'] }, ['item'], { id: 'r1', attack: 5 }, 0);
    expect(out).toEqual({ type: 'typography', content: '⚔5' });
  });
});
