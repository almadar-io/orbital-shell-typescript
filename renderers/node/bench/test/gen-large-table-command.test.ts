import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { benchCommand, genLargeTableCommand } from '../src/commands.js';
import { loadScenarioFixtures } from '../src/fixtures.js';

describe('gen-large-table', () => {
  it('writes the list and policy fixtures with the requested row count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-large-'));
    try {
      const files = await genLargeTableCommand(['--out', dir, '--rows', '250', '--seed', '9']);
      expect(files.map((f) => basename(f))).toEqual(['large-table-list.json', 'large-table-policy.json']);
      const fixtures = await loadScenarioFixtures(dir);
      expect(fixtures.map((f) => f.scenarios.length)).toEqual([5, 1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('control: --rows 0 is refused', async () => {
    await expect(genLargeTableCommand(['--out', tmpdir(), '--rows', '0'])).rejects.toThrow(/positive integer/);
  });

  it('a floor row refuses a reference it would never compare', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-large-empty-'));
    try {
      await expect(benchCommand(['--harness', 'F3', '--fixtures', dir, '--out', join(dir, 'x.json'), '--reference', 'B1-kernel'])).rejects.toThrow(/floor row/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
