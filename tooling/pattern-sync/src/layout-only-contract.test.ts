import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseComponent } from './parser.js';
import { toPatternEntry } from './writer.js';

function parseProbe(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'almadar-pattern-sync-'));
  const absolutePath = join(directory, 'Probe.tsx');
  try {
    writeFileSync(absolutePath, source);
    return parseComponent({ absolutePath, relativePath: 'core/atoms/Probe.tsx', fileName: 'Probe', level: 'atoms' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('layout-only contract', () => {
  it('reads @layoutOnly off the props interface', () => {
    const parsed = parseProbe(`/**
       * @layoutOnly
       */
      export interface ProbeProps { gap?: string; }
      export function Probe(): null { return null; }`);
    expect(parsed?.layoutOnly).toBe(true);
    expect(parsed ? toPatternEntry(parsed, undefined) : undefined).toMatchObject({ layoutOnly: true });
  });

  it('keeps the interface description when @layoutOnly sits beside it', () => {
    const parsed = parseProbe(`/**
       * Arranges children.
       * @layoutOnly
       */
      export interface ProbeProps { gap?: string; }
      export function Probe(): null { return null; }`);
    expect(parsed?.layoutOnly).toBe(true);
    expect(parsed?.description).toBe('Arranges children.');
  });

  it('leaves an untagged interface without the key', () => {
    const parsed = parseProbe(`/** Paints a card. */
      export interface ProbeProps { gap?: string; }
      export function Probe(): null { return null; }`);
    expect(parsed?.layoutOnly).toBeUndefined();
    expect(parsed ? 'layoutOnly' in toPatternEntry(parsed, undefined) : true).toBe(false);
  });
});
