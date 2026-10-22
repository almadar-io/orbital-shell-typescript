/**
 * UI-FORM-SECTION-INVALID-ITEM-TYPE (docs/Almadar_Std_Gaps.md): `orbital-core`'s
 * `FieldType` (Rust, `#[serde(rename_all = "lowercase")]`) admits `union` (a
 * tagged struct union — `lower_type_expr`'s `TypeExpr::Union` arm in
 * `orbital-lolo/src/lower/entity.rs`) on ANY field-descriptor position,
 * including a config field's `items.properties.<name>` (the same
 * `lower_config_fields_to_map` call funnels config items/properties through
 * `lower_type_expr` too). The JS mirror had three separate hand-written
 * copies of "the field-type enum" and each had drifted from Rust
 * independently:
 *   - `TraitEntityFieldSchema` (trait.ts) — governs `properties`/`items` on a
 *     trait's declared config fields and `dataEntities` fields. Its `type`
 *     zod enum never admitted `scalar`/`union`, even though the
 *     sibling TS type `TraitFieldType` already declared them — this is what
 *     rejected `ui-form-section.orb`'s `config.fields.items.properties
 *     .defaultValue` (type `"union"`) and, transitively, every `.orb` that
 *     `uses` it (`std-lms.orb`'s `EnrollmentOrbital`).
 *   - `RequiredFieldSchema` (trait.ts) — same enum, same gap, same
 *     `TraitFieldType` mismatch.
 *
 * `TRAIT_FIELD_TYPES` (trait.ts) is now the one array both trait-side zod
 * schemas read, mirroring `FIELD_TYPES` in field.ts — closing the drift
 * class, not just this one instance of it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  RequiredFieldSchema,
  TRAIT_FIELD_TYPES,
  TraitEntityFieldSchema,
} from '../src/types/trait.js';
import { installedRegistries } from './installed-registries.js';
import { parseOrbitalSchema, safeParseOrbitalSchema } from '../src/types/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('TraitEntityFieldSchema / RequiredFieldSchema admit the full TraitFieldType vocabulary', () => {
  it('TRAIT_FIELD_TYPES carries every newly-closed spelling', () => {
    expect(TRAIT_FIELD_TYPES).not.toContain('scalar');
    expect(TRAIT_FIELD_TYPES).toContain('union');
  });

  it.each(TRAIT_FIELD_TYPES)('TraitEntityFieldSchema round-trips type %s', (t) => {
    const parsed = TraitEntityFieldSchema.safeParse({ name: 'x', type: t, values: t === 'union' || t === 'enum' ? ['A'] : undefined });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.type).toBe(t);
  });

  it.each(TRAIT_FIELD_TYPES)('RequiredFieldSchema round-trips type %s', (t) => {
    const parsed = RequiredFieldSchema.safeParse({ name: 'x', type: t });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.type).toBe(t);
  });

  it('parses the real ui-form-section.orb tagged-union defaultValue shape', () => {
    const defaultValue = {
      name: 'defaultValue',
      required: false,
      type: 'union',
      values: ['string', 'number', 'boolean', 'array', 'FileValue'],
      properties: {
        string: { name: 'string', type: 'string' },
        number: { name: 'number', type: 'number' },
        boolean: { name: 'boolean', type: 'boolean' },
        array: { name: 'array', type: 'array', items: { type: 'string' } },
        FileValue: {
          name: 'FileValue',
          type: 'object',
          properties: {
            name: { name: 'name', required: true, type: 'string' },
            url: { name: 'url', required: true, type: 'string' },
            mimeType: { name: 'mimeType', required: true, type: 'string' },
            sizeBytes: { name: 'sizeBytes', required: true, type: 'number' },
          },
        },
      },
    };
    const parsed = TraitEntityFieldSchema.safeParse(defaultValue);
    expect(parsed.success).toBe(true);
  });
});

describe('registry integration — the real ui-form-section.orb / std-lms.orb files load', () => {
  const registries = installedRegistries(['@almadar/std', '@almadar-io/behaviors']);
  const stdRegistry = registries.get('@almadar/std') ?? '';
  const ioRegistry = registries.get('@almadar-io/behaviors') ?? '';
  const haveRegistries = registries.size === 2;

  it('ui-form-section.orb parses through parseOrbitalSchema (0 errors)', () => {
    if (!haveRegistries) return; // standalone (extracted) clone — no sibling registries
    const file = path.join(stdRegistry, 'ui/core/organisms/ui-form-section.orb');
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    expect(() => parseOrbitalSchema(raw)).not.toThrow();
  });

  it('std-lms.orb parses through parseOrbitalSchema — EnrollmentOrbital included (0 errors)', () => {
    if (!haveRegistries) return;
    const file = path.join(ioRegistry, 'app/organisms/std-lms.orb');
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const result = safeParseOrbitalSchema(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const names = result.data.orbitals.map((o) => o.name);
      expect(names).toContain('EnrollmentOrbital');
      expect(names).toContain('CourseOrbital');
    }
  });

});
