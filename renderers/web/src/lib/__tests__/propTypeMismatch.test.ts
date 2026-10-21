/**
 * A prop value whose SHAPE no declared type can accept is a type error the
 * renderer reports for that one element — the `app-1789833059828` crash was
 * the literal string "@config.navItems" reaching `dashboard-layout.navItems`
 * (declared `array`) and `navItems.map` throwing.
 */
import { describe, it, expect } from 'vitest';
import { propTypeMismatches } from '../propTypeMismatch';

const schema = {
  items: { types: ['array'], required: true },
  navItems: { types: ['array'] },
  title: { types: ['string'] },
  columns: { types: ['object', 'array'] },
  icon: { types: ['icon'] },
  trigger: { types: ['node'] },
  onClick: { types: ['function'] },
};

describe('propTypeMismatches', () => {
  it('flags a primitive where only structures are declared (the crash)', () => {
    expect(propTypeMismatches(schema, { items: [], navItems: '@config.navItems' })).toEqual([
      { prop: 'navItems', expected: ['array'], got: 'string' },
    ]);
  });

  it('flags a single object where only an array is declared', () => {
    expect(propTypeMismatches(schema, { items: [], navItems: { label: 'Home' } })).toEqual([
      { prop: 'navItems', expected: ['array'], got: 'object' },
    ]);
  });

  it('control: values whose shape a declared type accepts pass', () => {
    expect(propTypeMismatches(schema, {
      items: [],
      navItems: [{ label: 'Home' }],
      title: 'Hi',
      columns: { a: 1 },
      icon: 'star',
      trigger: 'Open',
      onClick: () => undefined,
    })).toEqual([]);
  });

  it('flags a required structure-only prop that is missing (an unresolved binding resolved to undefined)', () => {
    expect(propTypeMismatches(schema, { items: undefined })).toEqual([
      { prop: 'items', expected: ['array'], got: 'missing' },
    ]);
    expect(propTypeMismatches(schema, {})).toEqual([{ prop: 'items', expected: ['array'], got: 'missing' }]);
  });

  it('edge: absent/null optional props and undeclared props are never flagged', () => {
    expect(propTypeMismatches(schema, { items: [], navItems: null, title: undefined, extra: 42 })).toEqual([]);
  });

  it('edge: a prop delivered through the JSX children channel counts as present', () => {
    const withChildren = { children: { types: ['array'], required: true } };
    expect(propTypeMismatches(withChildren, {}, ['children'])).toEqual([]);
    expect(propTypeMismatches(withChildren, {})).toEqual([{ prop: 'children', expected: ['array'], got: 'missing' }]);
  });

  it('edge: a required prop that also accepts a primitive or node may be missing', () => {
    const loose = { label: { types: ['string'], required: true }, body: { types: ['node', 'array'], required: true } };
    expect(propTypeMismatches(loose, {})).toEqual([]);
  });

  it('edge: a loose type (node/icon) accepts any shape it can render', () => {
    expect(propTypeMismatches(schema, { items: [], trigger: ['a', 'b'], icon: { name: 'x' } })).toEqual([]);
  });
});
