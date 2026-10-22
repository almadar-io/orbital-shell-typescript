import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenarioFixtures } from '../src/fixtures.js';
import { createB1KernelHarness } from '../src/b1-kernel-harness.js';
import {
  DEFAULT_LARGE_TABLE,
  LIST_FIXTURE,
  PAGE_SIZE,
  POLICY_FIXTURE,
  expectedPages,
  generateRows,
  listFilterMatches,
  writeLargeTableFixtures,
} from '../src/large-table.js';
import type { JsonValue, ScenarioFixture, TraceStep } from '../src/types.js';

type JsonRecord = { [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadedPayload(step: TraceStep): { data: JsonValue; totalCount: JsonValue } {
  const emit = step.emits.find((e) => e.event === 'LOADED');
  if (emit === undefined || !isRecord(emit.payload)) throw new Error('no LOADED emit with an object payload');
  const { data, totalCount } = emit.payload;
  if (data === undefined || totalCount === undefined) throw new Error('LOADED payload lacks data or totalCount');
  return { data, totalCount };
}

function ids(data: JsonValue): JsonValue[] {
  if (!Array.isArray(data)) throw new Error('LOADED.data is not a list');
  return data.map((row) => (isRecord(row) ? (row.id ?? null) : null));
}

async function run(fixture: ScenarioFixture, name: string): Promise<TraceStep> {
  const scenario = fixture.scenarios.find((s) => s.name === name);
  if (scenario === undefined) throw new Error(`no scenario "${name}"`);
  const harness = createB1KernelHarness(process.env.ALMADAR_KERNEL_DIR);
  const session = await harness.open(fixture, scenario);
  try {
    return await session.dispatch(scenario.steps[0]);
  } finally {
    await session.close();
  }
}

describe('large-table generator', () => {
  it('is deterministic for a seed and different for another', () => {
    const a = generateRows({ rows: 500, seed: 7 });
    expect(generateRows({ rows: 500, seed: 7 })).toEqual(a);
    expect(generateRows({ rows: 500, seed: 8 })).not.toEqual(a);
  });

  it('gives every row a unique rank, so an ordered page has no ties', () => {
    const rows = generateRows({ rows: 2000, seed: 1 });
    expect(new Set(rows.map((r) => r.rank)).size).toBe(rows.length);
  });

  it('rejects a table with no rows', () => {
    expect(() => generateRows({ rows: 0, seed: 1 })).toThrow(/positive integer/);
  });

  it('computes pages from the rows alone: the list page is full and strictly descending', () => {
    const rows = generateRows(DEFAULT_LARGE_TABLE);
    const expected = expectedPages(rows);
    expect(rows).toHaveLength(100_000);
    expect(expected.listPage).toHaveLength(PAGE_SIZE);
    expect(expected.listPage.every(listFilterMatches)).toBe(true);
    expect(expected.listPage.map((r) => r.rank)).toEqual([...expected.listPage.map((r) => r.rank)].sort((a, b) => b - a));
    expect(expected.listMatches).toBeLessThan(rows.length);
    expect(expected.visible).toBeGreaterThan(PAGE_SIZE);
    expect(expected.visible).toBeLessThan(rows.length / 20);
  });
});

describe('large-table scenarios on B1 (100,000 rows)', () => {
  let dir = '';
  let listFixture: ScenarioFixture;
  let policyFixture: ScenarioFixture;
  const expected = expectedPages(generateRows(DEFAULT_LARGE_TABLE));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'large-table-'));
    await writeLargeTableFixtures(dir, DEFAULT_LARGE_TABLE);
    const loaded = await loadScenarioFixtures(dir);
    const list = loaded.find((f) => f.name === LIST_FIXTURE);
    const policy = loaded.find((f) => f.name === POLICY_FIXTURE);
    if (list === undefined || policy === undefined) throw new Error('generated fixtures were not written');
    listFixture = list;
    policyFixture = policy;
  }, 60000);

  afterAll(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true });
  });

  it('(a) the filtered, ordered page returns exactly 20 rows, the expected ones, with the filtered total', async () => {
    const { data, totalCount } = loadedPayload(await run(listFixture, '(a) filtered ordered page'));
    expect(Array.isArray(data) && data.length).toBe(PAGE_SIZE);
    expect(ids(data)).toEqual(expected.listPage.map((r) => r.id));
    expect(totalCount).toBe(expected.listMatches);
  }, 120000);

  it('(a) control: without the filter the same 20-row page reports the whole table', async () => {
    const { data, totalCount } = loadedPayload(await run(listFixture, '(a) control: unfiltered page'));
    expect(Array.isArray(data) && data.length).toBe(PAGE_SIZE);
    expect(totalCount).toBe(100_000);
    expect(totalCount).not.toBe(expected.listMatches);
  }, 120000);

  it('(b) under the @read policy a page of 20 is drawn only from the visible rows', async () => {
    const { data, totalCount } = loadedPayload(await run(policyFixture, '(b) page under a @read policy'));
    expect(ids(data)).toEqual(expected.policyPage.map((r) => r.id));
    expect(totalCount).toBe(expected.visible);
  }, 120000);

  it('(c) a detail read returns the one row; control: an absent id returns none', async () => {
    const found = loadedPayload(await run(listFixture, '(c) detail by id'));
    expect(isRecord(found.data) ? found.data.id : null).toBe(expected.detail.id);
    expect(found.totalCount).toBe(1);
    const missing = (await run(listFixture, '(c) control: id absent')).emits.find((e) => e.event === 'LOADED');
    expect(missing).toBeUndefined();
  }, 120000);

  it('(d) the rows-only render fetches a page and renders a table of that entity', async () => {
    const step = await run(listFixture, '(d) render rows only');
    expect(step.effects.some((effect) => Array.isArray(effect) && effect[0] === 'render-ui')).toBe(true);
    expect(ids(loadedPayload(step).data)).toHaveLength(PAGE_SIZE);
  }, 120000);
});
