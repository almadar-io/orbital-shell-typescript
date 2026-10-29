// R6: a related record is shown by its declared display field, carried as the injected relation option; with no option the
// record id — never a guessed name/title/label field of the row.
import { describe, it, expect } from 'vitest';
import type { FieldValue } from '@almadar/core';
import { relationLabel, relationDisplayLabels, resolveRelationCellDisplay } from '../src/lib/relationLabel';

const row = (fields: Record<string, string>): FieldValue => ({ id: 's1', ...fields });
const options = [{ value: 's1', label: 'Ada Lovelace' }];

describe('relation display', () => {
  it('a hydrated row reads the label of its injected option', () => {
    expect(relationLabel(row({ name: 'ignored' }), options)).toBe('Ada Lovelace');
    expect(relationDisplayLabels(row({}), options)).toEqual(['Ada Lovelace']);
    expect(resolveRelationCellDisplay(row({}), options)).toBe('Ada Lovelace');
  });

  it('control: with no option the record id shows, whatever name/title/label the row carries', () => {
    for (const key of ['name', 'title', 'label']) {
      expect(relationLabel(row({ [key]: 'Guessed' }))).toBe('s1');
      expect(relationLabel(row({ [key]: 'Guessed' }), [{ value: 's2', label: 'Other' }])).toBe('s1');
    }
    expect(relationDisplayLabels(row({ name: 'Guessed' }))).toEqual(['s1']);
  });

  it('edge: a bare foreign id resolves through its option, a non-row has no label', () => {
    expect(relationDisplayLabels('s1', options)).toEqual(['Ada Lovelace']);
    expect(relationDisplayLabels('s9', options)).toEqual(['s9']);
    expect(relationLabel('s1', options)).toBeNull();
    expect(relationLabel({ name: 'no id' })).toBeNull();
    expect(relationDisplayLabels([row({}), row({})], options)).toEqual(['Ada Lovelace', 'Ada Lovelace']);
  });
});
