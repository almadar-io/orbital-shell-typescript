import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type { EntityRow, PersistenceAdapter, RowQuery } from '@almadar/core';
import type { JsonValue } from './types.js';

export const WIDE_FIELDS = 40;
export const WIDE_PAGES = [20, 200, 1000] as const;
const WIDE_ROWS = 2000;

export type WideRow = { [key: string]: JsonValue };

/** A deterministic wide row: 38 string/number/boolean fields (strings of 8-200 characters), a small array, and the id. */
export function wideRow(i: number): WideRow {
  const row: WideRow = { id: `w-${String(i).padStart(6, '0')}` };
  for (let f = 0; f < WIDE_FIELDS - 2; f++) {
    if (f % 5 === 0) row[`n${f}`] = i * 7 + f;
    else if (f % 7 === 0) row[`b${f}`] = (i + f) % 2 === 0;
    else row[`s${f}`] = `v${i}-${f} `.repeat(1 + ((i * 31 + f * 17) % 25)).slice(0, 8 + ((i * 13 + f * 29) % 193));
  }
  row.tags = ['a', `t${i % 9}`, 'z'];
  return row;
}

export function wideRows(count: number): WideRow[] {
  return Array.from({ length: count }, (_, i) => wideRow(i));
}

function fieldDecls(): JsonValue[] {
  const names = Object.keys(wideRow(0));
  return names.map((name) => ({ name, type: name === 'id' ? 'string' : name.startsWith('n') ? 'number' : name.startsWith('b') ? 'boolean' : name === 'tags' ? 'array' : 'string' }));
}

function fetchTrait(name: string, entity: string, limit: number): JsonValue {
  return {
    name,
    linkedEntity: entity,
    emits: [{ event: 'LOADED' }],
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [{ key: 'GO', name: 'GO' }],
      transitions: [{ from: 'idle', to: 'idle', event: 'GO', effects: [['fetch', entity, { limit, emit: { success: 'LOADED' } }]] }],
    },
  };
}

/** `rows`: the fetched entity carries every field. `ids`: the same rows reduced to their id, which is what `deliver: ids` puts on the wire. */
export function buildWideSchema(kind: 'rows' | 'ids', pageSizes: readonly number[]): JsonValue {
  const entity = kind === 'rows' ? 'Wide' : 'WideIds';
  const rows = wideRows(WIDE_ROWS);
  return JSON.parse(
    JSON.stringify({
      name: `wide-table-${kind}`,
      version: '1.0.0',
      orbitals: [
        {
          name: 'Wide',
          pages: [],
          entity: {
            name: entity,
            fields: kind === 'rows' ? fieldDecls() : [{ name: 'id', type: 'string', required: true }],
            instances: kind === 'rows' ? rows : rows.map((r) => ({ id: r.id })),
          },
          traits: pageSizes.map((n) => fetchTrait(`Page${n}`, entity, n)),
        },
      ],
    }),
  );
}

export function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export interface Stat {
  p50: number;
  p95: number;
}

export function stat(samples: number[]): Stat {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

interface ServerHandle {
  start(orbital: string, requestJson: string): string;
  resume(flight: number, repliesJson: string): string;
  free(): void;
}

interface KernelModule {
  Server: new (resolvedSchemaJson: string) => ServerHandle;
  initSync(input: { module: Buffer }): unknown;
}

export async function loadKernel(dir: string): Promise<KernelModule> {
  const module: KernelModule = await import(pathToFileURL(join(dir, 'pkg/orbital_wasm.js')).href);
  module.initSync({ module: await readFile(join(dir, 'pkg/orbital_wasm_bg.wasm')) });
  return module;
}

interface HostRequest {
  id: number;
  request: { kind: string; entityType: string };
}

interface Progress {
  status: 'await' | 'done';
  flight: number;
  requests: HostRequest[];
  response?: { emittedEvents?: { event: string; payload?: { data?: EntityRow[] } }[] };
}

export interface Crossing {
  /** JSON.stringify of the host answers (JS to WASM, request side). */
  stringifyMs: number;
  /** The wasm calls: UTF-8 in, kernel work, string out. */
  wasmMs: number;
  /** JSON.parse of every progress/response string (WASM to JS). */
  parseMs: number;
  rows: EntityRow[];
  responseBytes: number;
  hostMs: number;
}

/** Runs one dispatch on the server role. `answer(entityType)` is the host's answer to a listRows (the pushed-down page). */
export async function driveFlight(server: ServerHandle, trait: string, answer: (entityType: string) => Promise<EntityRow[]>): Promise<Crossing> {
  const out: Crossing = { stringifyMs: 0, wasmMs: 0, parseMs: 0, rows: [], responseBytes: 0, hostMs: 0 };
  let t = performance.now();
  let text = server.start('Wide', JSON.stringify({ event: 'GO', targetTrait: trait }));
  out.wasmMs += performance.now() - t;
  for (;;) {
    t = performance.now();
    const progress: Progress = JSON.parse(text);
    out.parseMs += performance.now() - t;
    if (progress.status === 'done') {
      out.responseBytes = text.length;
      const loaded = (progress.response?.emittedEvents ?? []).find((e) => e.event === 'LOADED');
      if (loaded?.payload?.data === undefined) throw new Error('wide-table: LOADED carried no data');
      out.rows = loaded.payload.data;
      return out;
    }
    t = performance.now();
    const replies = await Promise.all(
      progress.requests.map(async (r) => ({
        id: r.id,
        answer: r.request.kind === 'readRow' ? { kind: 'row', result: { error: 'missing' } } : { kind: 'rows', result: { ok: await answer(r.request.entityType) } },
      })),
    );
    out.hostMs += performance.now() - t;
    t = performance.now();
    const body = JSON.stringify(replies);
    out.stringifyMs += performance.now() - t;
    t = performance.now();
    text = server.resume(progress.flight, body);
    out.wasmMs += performance.now() - t;
  }
}

export interface WideResult {
  page: number;
  rowsBytes: number;
  idsBytes: number;
  rows: Stat;
  ids: Stat;
  idsDispatch: Stat;
  idsResolve: Stat;
  gainPct: number;
  /** Share of the rows-path end to end spent in the JSON crossing (stringify + parse). */
  jsonSharePct: number;
}

export async function runWideTable(mod: KernelModule, store: PersistenceAdapter, iterations: number, warmup: number): Promise<WideResult[]> {
  const rowsServer = new mod.Server(JSON.stringify(buildWideSchema('rows', WIDE_PAGES)));
  const idsServer = new mod.Server(JSON.stringify(buildWideSchema('ids', WIDE_PAGES)));
  const results: WideResult[] = [];
  for (const page of WIDE_PAGES) {
    const trait = `Page${page}`;
    const rowSamples: number[] = [];
    const idSamples: number[] = [];
    const idDispatch: number[] = [];
    const idResolve: number[] = [];
    const jsonShare: number[] = [];
    let rowsBytes = 0;
    let idsBytes = 0;
    const pageRows = async (): Promise<EntityRow[]> => (await store.queryPage?.('Wide', { limit: page, total: 'none' }))?.rows ?? [];
    const pageIds = async (): Promise<EntityRow[]> => ((await store.queryIds?.('Wide', { limit: page, total: 'none' }))?.ids ?? []).map((id) => ({ id }));
    for (let i = -warmup; i < iterations; i++) {
      let t = performance.now();
      const rowFlight = await driveFlight(rowsServer, trait, pageRows);
      const rowMs = performance.now() - t;
      if (rowFlight.rows.length !== page) throw new Error(`rows page ${page}: got ${rowFlight.rows.length}`);

      t = performance.now();
      const idFlight = await driveFlight(idsServer, trait, pageIds);
      const dispatchMs = performance.now() - t;
      t = performance.now();
      const query: RowQuery = { filter: { kind: 'member', field: 'id', values: idFlight.rows.map((r) => String(r.id)) }, total: 'none' };
      const resolved = await store.queryPage?.('Wide', query);
      const resolveMs = performance.now() - t;
      if (resolved === undefined || resolved.rows.length !== page) throw new Error(`ids page ${page}: resolved ${resolved?.rows.length}`);
      if (i >= 0) {
        rowSamples.push(rowMs);
        idSamples.push(dispatchMs + resolveMs);
        idDispatch.push(dispatchMs);
        idResolve.push(resolveMs);
        jsonShare.push(((rowFlight.stringifyMs + rowFlight.parseMs) / rowMs) * 100);
        rowsBytes = rowFlight.responseBytes;
        idsBytes = idFlight.responseBytes;
      }
    }
    const rows = stat(rowSamples);
    const ids = stat(idSamples);
    results.push({ page, rowsBytes, idsBytes, rows, ids, idsDispatch: stat(idDispatch), idsResolve: stat(idResolve), gainPct: (1 - ids.p50 / rows.p50) * 100, jsonSharePct: stat(jsonShare).p50 });
  }
  rowsServer.free();
  idsServer.free();
  return results;
}

export function seedStore(store: { seed(data: Record<string, EntityRow[]>): void }): void {
  store.seed({ Wide: wideRows(WIDE_ROWS) as EntityRow[] });
}

export function formatWide(results: readonly WideResult[]): string {
  const lines = ['| page | rows bytes | ids bytes | rows p50/p95 ms | ids e2e p50/p95 ms | ids dispatch p50 | ids resolve p50 | gain p50 | JSON share of rows path |', '|---:|---:|---:|---|---|---:|---:|---:|---:|'];
  for (const r of results) {
    lines.push(`| ${r.page} | ${r.rowsBytes} | ${r.idsBytes} | ${r.rows.p50.toFixed(3)}/${r.rows.p95.toFixed(3)} | ${r.ids.p50.toFixed(3)}/${r.ids.p95.toFixed(3)} | ${r.idsDispatch.p50.toFixed(3)} | ${r.idsResolve.p50.toFixed(3)} | ${r.gainPct.toFixed(1)}% | ${r.jsonSharePct.toFixed(1)}% |`);
  }
  return lines.join('\n');
}
