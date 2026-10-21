import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageFixturesDir } from '../src/package-root.js';
import { loadScenarioFixtures, scenarioKey } from '../src/fixtures.js';

const dir = join(packageFixturesDir(), 'scenarios');

describe('loadScenarioFixtures', () => {
  it('loads a fixture directory and normalizes single-step and multi-step scenarios', async () => {
    const fixtures = await loadScenarioFixtures(dir);
    expect(fixtures.map((f) => f.name)).toEqual(['emit-fanout']);
    const [go, twice] = fixtures[0].scenarios;
    expect(go.steps).toEqual([
      { trait: 'Src', event: 'GO', payload: {}, expect: { states: { Src: 'idle', Sink: 'done' } } },
    ]);
    expect(twice.steps).toHaveLength(2);
    expect(scenarioKey(fixtures[0], 1)).toBe('emit-fanout#1');
  });

  it('control: an empty directory loads nothing, a missing directory is a hard error', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'parity-empty-'));
    expect(await loadScenarioFixtures(empty)).toEqual([]);
    await expect(loadScenarioFixtures(join(empty, 'absent'))).rejects.toThrow(/absent/);
  });

  it('rejects a fixture without scenarios, naming the file', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'parity-bad-'));
    writeFileSync(join(bad, 'broken.json'), JSON.stringify({ name: 'broken', schema: { orbitals: [] } }));
    await expect(loadScenarioFixtures(bad)).rejects.toThrow(/broken\.json.*scenarios/);
  });

  it('rejects a scenario that is neither single-step nor steps', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'parity-bad-'));
    mkdirSync(join(bad, 'nested'));
    writeFileSync(
      join(bad, 'x.json'),
      JSON.stringify({ name: 'x', schema: { orbitals: [] }, scenarios: [{ orbital: 'Main' }] }),
    );
    await expect(loadScenarioFixtures(bad)).rejects.toThrow(/x\.json.*scenarios\[0\]/);
  });
});
