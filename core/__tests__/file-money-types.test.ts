/**
 * `file` + `money` promoted value types (2026-08-20). Money is numeric at
 * rest; file is the canonical {name, url, mimeType, sizeBytes} struct. The
 * declared type — never a field-name heuristic — drives currency inputs/
 * formatting and the upload dropzone + download-chip rendering. Mirrors the
 * Rust promotion (FieldType::Money/File, OirType::Money/File); the shared
 * mock-seed parity vector pins the two seeders byte-for-byte.
 */

import { describe, it, expect } from 'vitest';
import {
  FIELD_TYPES,
  FieldTypeSchema,
  isFileValue,
} from '../index.js';
import { EntityFieldSchema } from '../src/types/field.js';

describe('the promoted value types', () => {
  it('are first-class field types', () => {
    for (const t of ['money', 'file'] as const) {
      expect(FIELD_TYPES).toContain(t);
      expect(FieldTypeSchema.safeParse(t).success).toBe(true);
      expect(EntityFieldSchema.safeParse({ name: 'x', type: t }).success).toBe(true);
    }
  });

  it('validates the canonical file struct value', () => {
    expect(
      isFileValue({ name: 'a.pdf', url: 'data:application/pdf;base64,AAAA', mimeType: 'application/pdf', sizeBytes: 4 }),
    ).toBe(true);
    expect(isFileValue('https://example.com/a.pdf')).toBe(false);
    expect(isFileValue({ name: 'a.pdf' })).toBe(false);
  });

  it('bytes is a first-class type that is not a string-domain type; unknown names stay rejected', () => {
    expect(FIELD_TYPES).toContain('bytes');
    expect(FieldTypeSchema.safeParse('bytes').success).toBe(true);
    expect(EntityFieldSchema.safeParse({ name: 'x', type: 'bytes' }).success).toBe(true);
    expect(EntityFieldSchema.safeParse({ name: 'x', type: 'bytez' }).success).toBe(false);
    expect(FieldTypeSchema.safeParse('bytez').success).toBe(false);
  });
});
