/**
 * The validator addresses an error by path, `orbitals[<index> (<name>)]…`
 * (orbital-rust `format!("orbitals[{} ({})]…")`). The orbital an error
 * belongs to is read from that declared shape by index — never by guessing.
 */
import { describe, it, expect } from 'vitest';
import { orbitalIndexOfValidationPath } from '../src/types/validation';

describe('orbitalIndexOfValidationPath', () => {
  it('reads the orbital index from a trait-level path', () => {
    expect(orbitalIndexOfValidationPath('orbitals[0 (SequenceOrbital)].traits[0 (SequenceAppLayout)]')).toBe(0);
    expect(orbitalIndexOfValidationPath('orbitals[12 (Deal Orbital)]')).toBe(12);
  });

  it('control: a bare index path and the segment form read the same', () => {
    expect(orbitalIndexOfValidationPath('orbitals[3].entity.fields[1]')).toBe(3);
    expect(orbitalIndexOfValidationPath(['orbitals', 3, 'entity', 'fields', 1])).toBe(3);
    expect(orbitalIndexOfValidationPath(['orbitals[0 (SequenceOrbital)]', 'traits[0 (SequenceAppLayout)]'])).toBe(0);
  });

  it('edge: a schema-level, empty or missing path belongs to no orbital', () => {
    expect(orbitalIndexOfValidationPath('config.navItems')).toBeNull();
    expect(orbitalIndexOfValidationPath('')).toBeNull();
    expect(orbitalIndexOfValidationPath(undefined)).toBeNull();
    expect(orbitalIndexOfValidationPath(['config', 'navItems'])).toBeNull();
    expect(orbitalIndexOfValidationPath(['orbitals', 'x'])).toBeNull();
  });
});
