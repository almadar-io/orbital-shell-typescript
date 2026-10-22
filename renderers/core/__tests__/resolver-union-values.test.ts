/**
 * `.lolo` string unions (`"income" | "expense"`) lower to `type: "string"`
 * with a `values: [...]` sidecar — `FieldType::Enum` is NEVER emitted by the
 * compiler. This test is pinned to that ACTUAL compiled shape, not to what a
 * TS consumer might assume: `schemaToIR` must carry the sidecar through to
 * `ResolvedEntity.fields[].values`/`enumValues`, or every union field in the
 * corpus (role, status, type, industry, ...) loses its options and downstream
 * forms render freeform text instead of a select. The Rust codegen path reads
 * `enum_values` unconditionally and has always been correct — this locks the
 * TS resolver to the same contract.
 */

import { describe, it, expect } from 'vitest';
import { parseOrbitalSchema } from '../src/types/schema.js';
import { schemaToIR } from '../src/resolver.js';

const schema = parseOrbitalSchema({
  name: 'UnionValuesApp',
  orbitals: [
    {
      name: 'TransactionOrbital',
      entity: {
        name: 'Transaction',
        fields: [
          { name: 'id', type: 'string', required: true },
          // the exact shape .orb.json emits for a .lolo union field
          { name: 'type', type: 'string', values: ['income', 'expense'] },
          { name: 'status', type: 'enum', values: ['draft', 'posted'] },
          {
            name: 'account',
            type: 'relation',
            relation: { entity: 'Account', cardinality: 'one' },
          },
          { name: 'description', type: 'string' },
        ],
      },
      traits: [],
      pages: [],
    },
  ],
});

describe('schemaToIR union-values sidecar (compiled shape)', () => {
  const ir = schemaToIR(schema, false);
  const fields = ir.entities.get('Transaction')?.fields ?? [];
  const byName = new Map(fields.map((f) => [f.name, f]));

  it('carries values off a string-typed field with a values sidecar', () => {
    expect(byName.get('type')?.values).toEqual(['income', 'expense']);
    expect(byName.get('type')?.enumValues).toEqual(['income', 'expense']);
  });

  it('still carries values off an explicit enum field', () => {
    expect(byName.get('status')?.values).toEqual(['draft', 'posted']);
    expect(byName.get('status')?.enumValues).toEqual(['draft', 'posted']);
  });

  it('leaves values undefined on fields without a vocabulary', () => {
    expect(byName.get('description')?.values).toBeUndefined();
    expect(byName.get('description')?.enumValues).toBeUndefined();
  });

  it('keeps the relation gate intact (relation carried, no values)', () => {
    expect(byName.get('account')?.relation?.entity).toBe('Account');
    expect(byName.get('account')?.values).toBeUndefined();
  });
});
