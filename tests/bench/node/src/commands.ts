import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareResults, referenceFromHarness, referenceFromResultFile, runBench, type BenchResult, type ReferenceTraces } from './bench.js';
import { resolveCommits } from './commits.js';
import { loadScenarioFixtures } from './fixtures.js';
import { writeDeviceWorkloads } from './device-workloads.js';
import { DEFAULT_LARGE_TABLE, writeLargeTableFixtures } from './large-table.js';
import { createHarnessById } from './registry.js';
import { renderReport } from './report.js';
import { unmetExpectations } from './trace.js';

export type FlagMap = Map<string, string[]>;

/** `--flag value [value...]`: every non-flag token after a flag belongs to it. */
export function parseFlags(argv: readonly string[]): FlagMap {
  const flags: FlagMap = new Map();
  let current: string[] | null = null;
  for (const token of argv) {
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const values = flags.get(name) ?? [];
      flags.set(name, values);
      if (eq !== -1) values.push(token.slice(eq + 1));
      current = values;
    } else if (current !== null) {
      current.push(token);
    } else {
      throw new Error(`unexpected argument "${token}"`);
    }
  }
  return flags;
}

function single(flags: FlagMap, name: string): string | undefined {
  const values = flags.get(name);
  if (values === undefined) return undefined;
  if (values.length !== 1) throw new Error(`--${name} takes exactly one value`);
  return values[0];
}

function required(flags: FlagMap, name: string): string {
  const value = single(flags, name);
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

function pairs(flags: FlagMap, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of flags.get(name) ?? []) {
    const eq = value.indexOf('=');
    if (eq <= 0) throw new Error(`--${name} expects name=value, got "${value}"`);
    out[value.slice(0, eq)] = value.slice(eq + 1);
  }
  return out;
}

function count(flags: FlagMap, name: string): number | undefined {
  const value = single(flags, name);
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

export async function benchCommand(argv: readonly string[]): Promise<BenchResult> {
  const flags = parseFlags(argv);
  const harness = createHarnessById(required(flags, 'harness'));
  const fixtures = await loadScenarioFixtures(resolve(required(flags, 'fixtures')));
  const out = resolve(required(flags, 'out'));
  const referenceId = single(flags, 'reference');
  const referenceFile = single(flags, 'reference-file');
  let references: ReferenceTraces;
  let referenceLabel: string;
  if (harness.ungated === true) {
    if (referenceId !== undefined || referenceFile !== undefined) throw new Error(`${harness.id} is a floor row and compares no trace; drop --reference and --reference-file`);
    references = new Map();
    referenceLabel = 'none (floor row)';
  } else {
    if ((referenceId === undefined) === (referenceFile === undefined)) {
      throw new Error('pass exactly one of --reference <harness-id> or --reference-file <bench.json>');
    }
    if (referenceId !== undefined) {
      references = await referenceFromHarness(createHarnessById(referenceId), fixtures);
      referenceLabel = referenceId;
    } else if (referenceFile !== undefined) {
      references = await referenceFromResultFile(resolve(referenceFile));
      referenceLabel = referenceFile;
    } else {
      throw new Error('unreachable');
    }
  }
  const commits = await resolveCommits(harness.measuredPackages, {
    shas: pairs(flags, 'commit'),
    dirs: pairs(flags, 'package-dir'),
  });
  const result = await runBench({
    harness,
    fixtures,
    references,
    referenceLabel,
    commits,
    environmentNote: single(flags, 'env-note'),
    warmupRuns: count(flags, 'warmup'),
    measuredRuns: count(flags, 'runs'),
    memoryEvents: count(flags, 'memory-events'),
    coldStartFixtures: flags.get('cold-start-fixture') ?? [],
    coldStartRuns: count(flags, 'cold-runs'),
  });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function genLargeTableCommand(argv: readonly string[]): Promise<string[]> {
  const flags = parseFlags(argv);
  const rows = count(flags, 'rows') ?? DEFAULT_LARGE_TABLE.rows;
  const seed = count(flags, 'seed') ?? DEFAULT_LARGE_TABLE.seed;
  return writeLargeTableFixtures(resolve(required(flags, 'out')), { rows, seed });
}

export async function genDeviceWorkloadsCommand(argv: readonly string[]): Promise<string[]> {
  const flags = parseFlags(argv);
  return writeDeviceWorkloads(resolve(required(flags, 'out')), {
    fixturesDir: resolve(required(flags, 'fixtures')),
    dispatchFixture: single(flags, 'fixture') ?? 'review-cycle',
    tickSchemaPath: resolve(required(flags, 'tick-schema')),
  });
}

export async function benchReportCommand(argv: readonly string[]): Promise<string> {
  const flags = parseFlags(argv);
  const inputs = flags.get('in') ?? [];
  if (inputs.length === 0) throw new Error('--in needs at least one result file');
  const results: BenchResult[] = [];
  for (const file of inputs) results.push(JSON.parse(await readFile(resolve(file), 'utf8')));
  const markdown = renderReport(results);
  await writeFile(resolve(required(flags, 'out')), `${markdown}\n`);
  return markdown;
}

export interface ScenarioCheckFailure {
  fixture: string;
  scenario: string;
  step: number;
  misses: string[];
}

/** Runs every fixture scenario through one harness and reports where a step misses its declared `expect`. */
export async function scenariosCommand(argv: readonly string[]): Promise<{ ran: number; failures: ScenarioCheckFailure[] }> {
  const flags = parseFlags(argv);
  const harness = createHarnessById(required(flags, 'harness'));
  const fixtures = await loadScenarioFixtures(resolve(required(flags, 'fixtures')));
  if (!(await harness.isAvailable())) throw new Error(`harness ${harness.id} is not available`);
  const failures: ScenarioCheckFailure[] = [];
  let ran = 0;
  for (const fixture of fixtures) {
    for (const scenario of fixture.scenarios) {
      ran += 1;
      const session = await harness.open(fixture, scenario);
      try {
        for (const [i, step] of scenario.steps.entries()) {
          const misses = unmetExpectations(await session.dispatch(step), step.expect, fixture.clockFields);
          if (misses.length > 0) failures.push({ fixture: fixture.name, scenario: scenario.name ?? `${step.trait}.${step.event}`, step: i + 1, misses });
        }
      } finally {
        await session.close();
      }
    }
  }
  return { ran, failures };
}

/** Where two result files' recorded traces differ: one line per workload. */
export async function benchCompareCommand(argv: readonly string[]): Promise<string> {
  const flags = parseFlags(argv);
  const fixtures = await loadScenarioFixtures(resolve(required(flags, 'fixtures')));
  const left: BenchResult = JSON.parse(await readFile(resolve(required(flags, 'left')), 'utf8'));
  const right: BenchResult = JSON.parse(await readFile(resolve(required(flags, 'right')), 'utf8'));
  const lines = compareResults(left, right, fixtures).map((d) => {
    const detail = d.outcome === 'differs' && d.difference !== undefined ? `step ${d.difference.stepIndex + 1} ${d.difference.field}` : d.reason ?? '';
    return `${d.outcome.padEnd(11)} ${d.key} ${d.label} ${detail}`.trimEnd();
  });
  return lines.join('\n');
}
