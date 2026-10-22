// Twin of orbital-core `ConfigField::is_declaration_form`: whether a call-site config entry re-declares
// its knob (allowed for a knob the trait does not declare) or is a value (refused there).
import { describe, it, expect } from 'vitest';
import { isConfigRedeclaration } from '../index';

describe('isConfigRedeclaration', () => {
  it('a typed declaration, or one carrying declaration metadata, re-declares the knob', () => {
    expect(isConfigRedeclaration({ type: 'string', default: 'x' })).toBe(true);
    expect(isConfigRedeclaration({ type: 'unknown', default: 'x', label: 'Title' })).toBe(true);
    expect(isConfigRedeclaration({ type: 'unknown', default: 'x', tier: 'domain' })).toBe(true);
  });

  it('control: a value wrapped as { type: unknown, default } is a value', () => {
    expect(isConfigRedeclaration({ type: 'unknown', default: 'x' })).toBe(false);
  });

  it('control: a plain value is a value', () => {
    expect(isConfigRedeclaration('x')).toBe(false);
    expect(isConfigRedeclaration({ title: 'x' })).toBe(false);
  });
});
