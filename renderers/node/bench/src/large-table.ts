import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OrbitalSchema, SExpr } from '@almadar/core';
import type { JsonValue, Scenario, ScenarioFixture } from './types.js';

export const LARGE_TABLE_ROWS = 100_000;
export const LARGE_TABLE_SEED = 20261013;
export const LIST_FIXTURE = 'large-table-list';
export const POLICY_FIXTURE = 'large-table-policy';
export const PAGE_SIZE = 20;
export const LIST_PAGE_OFFSET = 40;
export const DETAIL_ROW_NUMBER = 50_000;

const STATUSES = ['open', 'closed', 'archived'] as const;
const OPEN_SHARE = 1 / 3;
const PUBLIC_SHARE = 0.01;
const TENANTS = 10;
const MIN_PRIORITY_FOR_LIST = 4;

export interface LargeTableRow {
  id: string;
  title: string;
  status: (typeof STATUSES)[number];
  priority: number;
  tenant: string;
  visibility: 'public' | 'internal';
  /** Unique across the table (a seeded permutation), so an ordered page has no ties. */
  rank: number;
}

export interface LargeTableOptions {
  rows: number;
  seed: number;
}

export const DEFAULT_LARGE_TABLE: LargeTableOptions = { rows: LARGE_TABLE_ROWS, seed: LARGE_TABLE_SEED };

/** mulberry32: a 32-bit seeded generator; the same seed gives the same table on every machine. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rowId(number: number): string {
  return `row-${String(number).padStart(6, '0')}`;
}

export function generateRows(options: LargeTableOptions): LargeTableRow[] {
  if (!Number.isInteger(options.rows) || options.rows < 1) throw new Error('rows must be a positive integer');
  const random = seededRandom(options.seed);
  const ranks = Array.from({ length: options.rows }, (_, i) => i);
  for (let i = ranks.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const held = ranks[i];
    ranks[i] = ranks[j];
    ranks[j] = held;
  }
  const rows: LargeTableRow[] = [];
  for (let n = 1; n <= options.rows; n++) {
    const status = random() < OPEN_SHARE ? 'open' : random() < 0.5 ? 'closed' : 'archived';
    rows.push({
      id: rowId(n),
      title: `Record ${n}`,
      status,
      priority: 1 + Math.floor(random() * 5),
      tenant: `t${Math.floor(random() * TENANTS)}`,
      visibility: random() < PUBLIC_SHARE ? 'public' : 'internal',
      rank: ranks[n - 1],
    });
  }
  return rows;
}

export function listFilterMatches(row: LargeTableRow): boolean {
  return row.status === 'open' && row.priority >= MIN_PRIORITY_FOR_LIST;
}

export function policyAllows(row: LargeTableRow): boolean {
  return row.visibility === 'public';
}

export interface ExpectedPages {
  /** Rows matching the list filter, across all pages. */
  listMatches: number;
  /** The scenario (a) page: filter, `rank` descending, offset and limit applied. */
  listPage: LargeTableRow[];
  /** Rows the `@read` policy lets through. */
  visible: number;
  /** The scenario (b) page: policy, `rank` descending, first page. */
  policyPage: LargeTableRow[];
  /** Scenario (c)'s row. */
  detail: LargeTableRow;
}

/** What each scenario must return, computed straight from the generated rows (no kernel, no runtime). */
export function expectedPages(rows: readonly LargeTableRow[]): ExpectedPages {
  const byRankDescending = (a: LargeTableRow, b: LargeTableRow): number => b.rank - a.rank;
  const matches = rows.filter(listFilterMatches).sort(byRankDescending);
  const visible = rows.filter(policyAllows).sort(byRankDescending);
  const detail = rows.find((r) => r.id === rowId(DETAIL_ROW_NUMBER)) ?? rows[Math.floor(rows.length / 2)];
  return {
    listMatches: matches.length,
    listPage: matches.slice(LIST_PAGE_OFFSET, LIST_PAGE_OFFSET + PAGE_SIZE),
    visible: visible.length,
    policyPage: visible.slice(0, PAGE_SIZE),
    detail,
  };
}

const ROW_FIELDS = [
  { name: 'id', type: 'string', required: true },
  { name: 'title', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'priority', type: 'number' },
  { name: 'tenant', type: 'string' },
  { name: 'visibility', type: 'string' },
  { name: 'rank', type: 'number' },
] as const;

const field = (name: string): SExpr => ['object/get', '@entity', name];

const LIST_FILTER: SExpr = ['and', ['=', field('status'), 'open'], ['>=', field('priority'), MIN_PRIORITY_FOR_LIST]];
const ORDER = 'rank:desc';

type FetchOptions = { [key: string]: JsonValue };

function fetchTrait(name: string, entity: string, options: FetchOptions): JsonValue {
  return {
    name,
    linkedEntity: entity,
    emits: [{ event: 'LOADED' }],
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [{ key: 'GO', name: 'GO' }],
      transitions: [{ from: 'idle', to: 'idle', event: 'GO', effects: [['fetch', entity, { ...options, emit: { success: 'LOADED' } }]] }],
    },
  };
}

function renderTrait(name: string, entity: string, options: FetchOptions): JsonValue {
  return {
    name,
    linkedEntity: entity,
    emits: [{ event: 'LOADED' }],
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [{ key: 'GO', name: 'GO' }],
      transitions: [
        {
          from: 'idle',
          to: 'idle',
          event: 'GO',
          effects: [
            ['fetch', entity, { ...options, emit: { success: 'LOADED' } }],
            ['render-ui', 'main', { type: 'entity-table', entity, columns: ['title', 'status'] }],
          ],
        },
      ],
    },
  };
}

function schemaFor(name: string, entity: string, rows: readonly LargeTableRow[], traits: JsonValue[], readPolicy: SExpr | undefined): OrbitalSchema {
  const schema: JsonValue = {
    name,
    version: '1.0.0',
    orbitals: [
      {
        name: 'Rows',
        pages: [],
        entity: {
          name: entity,
          fields: ROW_FIELDS.map((f) => ({ ...f })),
          instances: rows.map((r) => ({ ...r })),
          ...(readPolicy === undefined ? {} : { read_policy: readPolicy }),
        },
        traits,
      },
    ],
  };
  return JSON.parse(JSON.stringify(schema));
}

function scenario(name: string, trait: string): Scenario {
  return { name, orbital: 'Rows', steps: [{ trait, event: 'GO', payload: {} }] };
}

const CLOCK_FIELDS = ['LOADED.data.*.createdAt', 'LOADED.data.*.updatedAt', 'LOADED.data.createdAt', 'LOADED.data.updatedAt'];

/** Scenarios (a), (c), (d) and the controls, on a table with no `@read` policy. */
export function buildListFixture(rows: readonly LargeTableRow[]): ScenarioFixture {
  const detailId = rowId(DETAIL_ROW_NUMBER);
  const traits: JsonValue[] = [
    fetchTrait('ListPage', 'Row', { filter: LIST_FILTER, orderBy: ORDER, offset: LIST_PAGE_OFFSET, limit: PAGE_SIZE }),
    fetchTrait('ListAll', 'Row', { orderBy: ORDER, limit: PAGE_SIZE }),
    fetchTrait('Detail', 'Row', { id: detailId }),
    fetchTrait('DetailMissing', 'Row', { id: 'row-absent' }),
    renderTrait('RowsView', 'Row', { orderBy: ORDER, limit: PAGE_SIZE }),
  ];
  return {
    name: LIST_FIXTURE,
    description: `${rows.length} rows: (a) a filtered, ordered page of ${PAGE_SIZE}, (c) a detail read by id, (d) a render that only shows rows; ListAll and DetailMissing are the controls`,
    schema: schemaFor(LIST_FIXTURE, 'Row', rows, traits, undefined),
    clockFields: CLOCK_FIELDS,
    mintedIdFields: [],
    scenarios: [
      scenario('(a) filtered ordered page', 'ListPage'),
      scenario('(a) control: unfiltered page', 'ListAll'),
      scenario('(c) detail by id', 'Detail'),
      scenario('(c) control: id absent', 'DetailMissing'),
      scenario('(d) render rows only', 'RowsView'),
    ],
  };
}

const POLICY: SExpr = ['=', field('visibility'), 'public'];

/** Scenario (b): the same table under a `@read` policy that hides all but about one row in a hundred. */
export function buildPolicyFixture(rows: readonly LargeTableRow[]): ScenarioFixture {
  const traits: JsonValue[] = [fetchTrait('PolicyPage', 'Private', { orderBy: ORDER, limit: PAGE_SIZE })];
  return {
    name: POLICY_FIXTURE,
    description: `${rows.length} rows under a @read policy (visibility = public) that hides most of them; one ordered page of ${PAGE_SIZE}`,
    schema: schemaFor(POLICY_FIXTURE, 'Private', rows, traits, POLICY),
    clockFields: CLOCK_FIELDS,
    mintedIdFields: [],
    scenarios: [scenario('(b) page under a @read policy', 'PolicyPage')],
  };
}

export function buildLargeTableFixtures(options: LargeTableOptions): ScenarioFixture[] {
  const rows = generateRows(options);
  return [buildListFixture(rows), buildPolicyFixture(rows)];
}

/** Writes `large-table-list.json` and `large-table-policy.json` into `dir`, the format every bench row reads. */
export async function writeLargeTableFixtures(dir: string, options: LargeTableOptions): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const fixture of buildLargeTableFixtures(options)) {
    const file = join(dir, `${fixture.name}.json`);
    const body = { name: fixture.name, description: fixture.description, schema: fixture.schema, clockFields: fixture.clockFields, scenarios: fixture.scenarios };
    await writeFile(file, JSON.stringify(body));
    written.push(file);
  }
  return written;
}
