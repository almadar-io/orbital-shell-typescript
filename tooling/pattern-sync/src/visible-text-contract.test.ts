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

const CORE_IMPORT = `import type { VisibleText } from '@almadar/core';`;

describe('visible-text contract', () => {
  it('marks a VisibleText prop as text and keeps its types', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps { label?: VisibleText; }
      export function Probe(): null { return null; }`);
    const prop = parsed?.props.find((p) => p.name === 'label');
    expect(prop).toMatchObject({ types: ['string'], kind: 'text' });
    expect(prop?.itemKind).toBeUndefined();
  });

  it('marks a VisibleText[] prop as an array with itemKind text', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps {
        lines?: VisibleText[];
        viaArray?: Array<VisibleText>;
        viaReadonly?: readonly VisibleText[];
      }
      export function Probe(): null { return null; }`);
    for (const name of ['lines', 'viaArray', 'viaReadonly']) {
      const prop = parsed?.props.find((p) => p.name === name);
      expect(prop).toMatchObject({ types: ['array'], itemKind: 'text' });
      expect(prop?.kind).toBeUndefined();
    }
  });

  it('keeps text on a struct member of an array item and not on its siblings', () => {
    const parsed = parseProbe(`${CORE_IMPORT}
      export interface ProbeProps { items: { caption: VisibleText; id: string }[]; }
      export function Probe(): null { return null; }`);
    const prop = parsed?.props.find((p) => p.name === 'items');
    expect(prop?.items?.properties?.caption?.kind).toBe('text');
    expect(prop?.items?.properties?.id).toBeDefined();
    expect(prop?.items?.properties?.id?.kind).toBeUndefined();
  });

  it('ignores a VisibleText declared locally instead of imported from core', () => {
    const parsed = parseProbe(`type VisibleText = string;
      export interface ProbeProps { label?: VisibleText; lines?: VisibleText[]; }
      export function Probe(): null { return null; }`);
    expect(JSON.stringify(parsed?.props)).not.toContain('"text"');
  });

  it('gives a plain string prop named label no kind', () => {
    const parsed = parseProbe(`export interface ProbeProps { label?: string; }
      export function Probe(): null { return null; }`);
    const prop = parsed?.props.find((p) => p.name === 'label');
    expect(prop?.types).toEqual(['string']);
    expect(prop?.kind).toBeUndefined();
    expect(prop?.itemKind).toBeUndefined();
  });
});
