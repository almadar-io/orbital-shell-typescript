import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseComponent } from './parser.js';

function parseProbe(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'almadar-pattern-sync-'));
  const absolutePath = join(directory, 'Probe.tsx');
  try {
    writeFileSync(absolutePath, source);
    return parseComponent({ absolutePath, relativePath: 'core/organisms/Probe.tsx', fileName: 'Probe', level: 'organisms' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const CORE_IMPORT = `import type { EntityFieldName, EventEmit } from '@almadar/core';`;

describe('field-ref contract', () => {
  it('marks an EntityFieldName prop as field-ref', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps { imageField?: EntityFieldName; }
      export function Probe(): null { return null; }`);
    const prop = parsed?.props.find((p) => p.name === 'imageField');
    expect(prop).toMatchObject({ types: ['string'], kind: 'field-ref' });
    expect(prop?.itemKind).toBeUndefined();
  });

  it('marks an EntityFieldName[] prop as an array with itemKind field-ref', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps {
        groupBy?: EntityFieldName[];
        viaArray?: Array<EntityFieldName>;
        viaReadonly?: readonly EntityFieldName[];
      }
      export function Probe(): null { return null; }`);
    for (const name of ['groupBy', 'viaArray', 'viaReadonly']) {
      const prop = parsed?.props.find((p) => p.name === name);
      expect(prop).toMatchObject({ types: ['array'], itemKind: 'field-ref' });
      expect(prop?.kind).toBeUndefined();
    }
  });

  it('keeps field-ref on a struct member of an array item and not on its siblings', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps { filters: { field: EntityFieldName; label: string }[]; }
      export function Probe(): null { return null; }`);
    const prop = parsed?.props.find((p) => p.name === 'filters');
    expect(prop?.items?.properties?.field?.kind).toBe('field-ref');
    expect(prop?.items?.properties?.label).toBeDefined();
    expect(prop?.items?.properties?.label?.kind).toBeUndefined();
    expect(prop?.itemKind).toBeUndefined();
  });

  it('ignores an EntityFieldName declared locally instead of imported from core', () => {
    const parsed = parseProbe(`type EntityFieldName = string;
      export interface ProbeProps {
        imageField?: EntityFieldName;
        groupBy?: EntityFieldName[];
        filters: { field: EntityFieldName }[];
      }
      export function Probe(): null { return null; }`);
    expect(JSON.stringify(parsed?.props)).not.toContain('field-ref');
  });

  it('gives a plain string prop named field no kind', () => {
    const parsed = parseProbe(`export interface ProbeProps { field?: string; }
      export function Probe(): null { return null; }`);
    const prop = parsed?.props.find((p) => p.name === 'field');
    expect(prop?.kind).toBeUndefined();
    expect(prop?.itemKind).toBeUndefined();
  });

  it('reads @changedBy off the prop and leaves untagged props without it', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps {
        /**
         * @changedBy onChange
         */
        value?: string;
        label?: string;
        onChange?: EventEmit<{ value: string }>;
      }
      export function Probe(): null { return null; }`);
    expect(parsed?.props.find((p) => p.name === 'value')?.changedBy).toEqual(['onChange']);
    expect(parsed?.props.find((p) => p.name === 'label')?.changedBy).toBeUndefined();
    expect(parsed?.props.find((p) => p.name === 'onChange')?.kind).toBe('event-ref');
  });

  it('collects repeated @changedBy tags in order and drops duplicates', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps {
        /**
         * @changedBy onChange
         * @changedBy onValueChange
         * @changedBy action
         */
        value?: string | string[];
        /**
         * @changedBy onChange
         * @changedBy onChange
         */
        other?: string;
        onChange?: EventEmit<{ value: string }>;
        onValueChange?: EventEmit<{ value: string }>;
        action?: EventEmit<{ value: string }>;
      }
      export function Probe(): null { return null; }`);
    expect(parsed?.props.find((p) => p.name === 'value')?.changedBy).toEqual(['onChange', 'onValueChange', 'action']);
    expect(parsed?.props.find((p) => p.name === 'other')?.changedBy).toEqual(['onChange']);
  });
});
