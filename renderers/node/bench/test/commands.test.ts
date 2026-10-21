import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageFixturesDir } from '../src/package-root.js';
import { benchCommand, benchReportCommand, parseFlags, scenariosCommand } from '../src/commands.js';
import type { BenchResult } from '../src/bench.js';

const fixtures = join(packageFixturesDir(), 'scenarios');

describe('parseFlags', () => {
  it('collects multiple values and = forms, control: a leading bare token is refused', () => {
    const flags = parseFlags(['--in', 'a.json', 'b.json', '--out=x.md']);
    expect(flags.get('in')).toEqual(['a.json', 'b.json']);
    expect(flags.get('out')).toEqual(['x.md']);
    expect(() => parseFlags(['stray'])).toThrow(/unexpected argument/);
  });
});

describe('scenarios command', () => {
  it('passes the in-package fixture through B1-kernel with every expectation met', async () => {
    const out = await scenariosCommand(['--harness', 'B1-kernel', '--fixtures', fixtures]);
    expect(out).toEqual({ ran: 2, failures: [] });
  });
});

describe('bench + bench-report commands', () => {
  it('B1-kernel against itself as reference writes a timed result, and the report renders it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-cmd-'));
    const out = join(dir, 'b1.json');
    const result = await benchCommand([
      '--harness', 'B1-kernel', '--fixtures', fixtures, '--out', out, '--reference', 'B1-kernel',
      '--warmup', '1', '--runs', '3', '--memory-events', '50', '--commit', '@almadar/runtime=deadbeef',
    ]);
    expect(result.workloads.map((w) => w.status)).toEqual(['timed', 'timed']);
    const written: BenchResult = JSON.parse(readFileSync(out, 'utf8'));
    expect(written.commits['@almadar/runtime']).toEqual({ sha: 'deadbeef' });
    const md = join(dir, 'report.md');
    const markdown = await benchReportCommand(['--in', out, '--out', md]);
    expect(readFileSync(md, 'utf8')).toBe(`${markdown}\n`);
    expect(markdown).toContain('| B1-kernel |');
  });

  it('control: both or neither reference flag is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-cmd-'));
    const base = ['--harness', 'B1-kernel', '--fixtures', fixtures, '--out', join(dir, 'x.json')];
    await expect(benchCommand(base)).rejects.toThrow(/exactly one of --reference/);
    await expect(benchCommand([...base, '--reference', 'B1-kernel', '--reference-file', 'y.json'])).rejects.toThrow(/exactly one of --reference/);
  });
});
