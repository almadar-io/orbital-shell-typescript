import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseComponent } from './parser.js';
import { PATTERNS_DIR } from './config.js';

describe('render callback contract', () => {
  it('keeps return-valued functions out of the authored JSON contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'almadar-pattern-sync-'));
    const absolutePath = join(directory, 'Probe.tsx');
    try {
      writeFileSync(absolutePath, `export interface ProbeProps {
        describe?: (value: { trait: string }) => Promise<{ text: string }>;
        onSelect?: (id: string) => void;
      }
      export function Probe(): null { return null; }
      `);
      const parsed = parseComponent({ absolutePath, relativePath: 'core/organisms/Probe.tsx', fileName: 'Probe', level: 'organisms' });
      const describe = parsed?.props.find((prop) => prop.name === 'describe');
      const select = parsed?.props.find((prop) => prop.name === 'onSelect');
      expect(describe).toMatchObject({ types: ['function'], renderCallback: true, nonAuthorable: true });
      expect(describe?.kind).toBeUndefined();
      expect(select).toMatchObject({ types: ['function'], kind: 'callback' });
      expect(select?.nonAuthorable).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('marks MachinePanel describe as runtime-only in the generated shared registry', () => {
    const registry = JSON.parse(readFileSync(join(PATTERNS_DIR, 'patterns-registry.json'), 'utf8'));
    const describe = registry.patterns['machine-panel'].propsSchema.describe;
    expect(describe).toMatchObject({ types: ['function'], renderCallback: true, nonAuthorable: true });
    expect(describe.kind).toBeUndefined();
  });
});
