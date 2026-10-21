import { describe, it, expect } from 'vitest';
import { badgeVariantFor, normalizeDisplayFields, titleFieldOf, valueLabelFor } from '../displayField';

describe('displayField', () => {
  it('normalizes strings, declared fields and the legacy key/header spelling', () => {
    expect(normalizeDisplayFields(['status', { name: 'title', variant: 'h3' }, { key: 'amount', header: 'Amount' }])).toEqual([
      { name: 'status' },
      { name: 'title', variant: 'h3' },
      { name: 'amount', label: 'Amount' },
    ]);
  });

  it('control: empty names are dropped', () => {
    expect(normalizeDisplayFields(['', { key: '' }])).toEqual([]);
  });

  it('a badge colour comes only from the declared colorMap', () => {
    expect(badgeVariantFor('failed', { failed: 'destructive' })).toBe('danger');
    expect(badgeVariantFor('active', { active: 'success' })).toBe('success');
  });

  it('control: an unmapped value is neutral, whatever it says', () => {
    expect(badgeVariantFor('failed', undefined)).toBe('default');
    expect(badgeVariantFor('active', { done: 'success' })).toBe('default');
  });

  it('the title is the declared h3/h4 field, never the first by position', () => {
    expect(titleFieldOf([{ name: 'id' }, { name: 'name', variant: 'h4' }])?.name).toBe('name');
    expect(titleFieldOf([{ name: 'id' }, { name: 'name' }])).toBeUndefined();
  });

  it('a value shows its declared label', () => {
    expect(valueLabelFor('in_progress', { in_progress: 'قيد التنفيذ' })).toBe('قيد التنفيذ');
  });

  it('control: an unlabelled value shows exactly as stored, never prettified', () => {
    expect(valueLabelFor('in_progress', undefined)).toBe('in_progress');
    expect(valueLabelFor('in_progress', { done: 'Done' })).toBe('in_progress');
  });
});
