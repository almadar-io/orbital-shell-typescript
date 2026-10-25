/**
 * Semantic scalar types: `email | url | phone | uuid | image`.
 *
 * These replaced the optional `format` property, which had zero producers
 * anywhere in the repo and no Rust counterpart at all — so it was unreachable
 * from `.lolo` and every consumer fell back to guessing from field names.
 */

import { describe, it, expect } from 'vitest';
import {
  FIELD_TYPES,
  FieldTypeSchema,
  SEMANTIC_STRING_PATTERNS,
  SEMANTIC_STRING_TYPES,
  isEmailValue,
  isPhoneValue,
  isSemanticStringType,
  isSemanticStringValue,
  isUrlValue,
  isUuidValue,
} from '../index.js';
import { EntityFieldSchema } from '../src/types/field.js';

describe('the type vocabulary', () => {
  it('carries the five semantic domains', () => {
    for (const t of SEMANTIC_STRING_TYPES) {
      expect(FIELD_TYPES).toContain(t);
      expect(FieldTypeSchema.safeParse(t).success).toBe(true);
      expect(isSemanticStringType(t)).toBe(true);
    }
  });

  it('does not mistake a bare string for a semantic domain', () => {
    expect(isSemanticStringType('string')).toBe(false);
    expect(isSemanticStringType('date')).toBe(false);
  });

  it('parses a semantic-typed field through the discriminated union', () => {
    for (const t of SEMANTIC_STRING_TYPES) {
      const parsed = EntityFieldSchema.safeParse({ name: 'x', type: t });
      expect(parsed.success, `${t} must parse as an entity field`).toBe(true);
    }
  });

  it('has retired FieldFormat entirely', async () => {
    const core = (await import('../index.js')) as Record<string, unknown>;
    expect(core['FieldFormatSchema']).toBeUndefined();
  });
});

describe('value validators', () => {
  it('accepts and rejects emails', () => {
    expect(isEmailValue('maya@example.com')).toBe(true);
    expect(isEmailValue('not-an-email')).toBe(false);
    expect(isEmailValue('missing@domain')).toBe(false);
    expect(isEmailValue('')).toBe(false);
  });

  it('reads the one pattern table the kernel validators carry', () => {
    expect(Object.keys(SEMANTIC_STRING_PATTERNS).sort()).toEqual(['email', 'phone', 'url', 'uuid']);
    expect(isUrlValue('http://x.y')).toBe(true);
    expect(isUrlValue('ftp://example.com')).toBe(false);
    expect(isUuidValue('550E8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuidValue('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('accepts and rejects urls', () => {
    expect(isUrlValue('https://example.com/a')).toBe(true);
    expect(isUrlValue('http://example.com')).toBe(true);
    expect(isUrlValue('Href')).toBe(false);
    // A base64 data URL is NOT an http(s) url — this is the exact false
    // positive that makes name-based retyping unsafe (`signatureDataUrl`).
    expect(isUrlValue('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
  });

  it('accepts and rejects phone numbers', () => {
    expect(isPhoneValue('+1 (555) 123-4567')).toBe(true);
    expect(isPhoneValue('5551234')).toBe(true);
    expect(isPhoneValue('call me')).toBe(false);
  });

  it('accepts and rejects uuids', () => {
    expect(isUuidValue('00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuidValue('abc')).toBe(false);
  });

  it('routes image through the url rule', () => {
    expect(isSemanticStringValue('image', 'https://picsum.photos/seed/a/400/400')).toBe(true);
    expect(isSemanticStringValue('image', 'Cover Image')).toBe(false);
  });
});
