import type { EntityRow } from '@almadar/core';
import type { IoAnswerWire, IoReplyWire, IoRequestWire, ServerProgressWire } from '@almadar/core/kernel-wire';
import { DEFAULT_VIEWER } from './kernel-trace.js';
import type { JsonValue, Scenario, ScenarioFixture, ScenarioStep } from './types.js';

/** The `Server` class of `@almadar/kernel`, as the floor rows drive it: JSON strings in and out. */
export interface FloorServer {
  start(orbital: string, requestJson: string): string;
  resume(flight: number, repliesJson: string): string;
  setDefaultUser(userJson: string): void;
  free(): void;
}

export interface FloorWasm {
  memory: WebAssembly.Memory;
  __wbindgen_malloc(size: number, align: number): number;
  __wbindgen_free(ptr: number, size: number, align: number): void;
}

export interface FloorKernelModule {
  Server: new (resolvedSchemaJson: string) => FloorServer;
  initSync(input: { module: Buffer }): FloorWasm;
}

/** One call across the boundary: the string that went in and the string that came back. */
export interface Crossing {
  kind: 'start' | 'resume';
  flight: number;
  input: string;
  output: string;
}

/** The kernel's whole conversation for one step: every crossing, in order, with the host answers pre-built. */
export interface RecordedStep {
  step: ScenarioStep;
  crossings: Crossing[];
}

type EntityRows = Map<string, EntityRow[]>;

function seedRows(fixture: ScenarioFixture): EntityRows {
  const rows: EntityRows = new Map();
  for (const orbital of fixture.schema.orbitals) {
    const entity = orbital.entity;
    if (typeof entity !== 'object' || entity === null || !('name' in entity) || typeof entity.name !== 'string') continue;
    const instances = 'instances' in entity && Array.isArray(entity.instances) ? entity.instances : [];
    rows.set(entity.name, instances.map((row) => ({ ...row })));
  }
  return rows;
}

function ok<T>(value: T): { ok: T } {
  return { ok: value };
}

function rowCopy(row: EntityRow): EntityRow {
  return structuredClone(row);
}

function rowValue(row: EntityRow | undefined): EntityRow | null {
  return row === undefined ? null : rowCopy(row);
}

/**
 * The host's side of the conversation for the I/O the floor rows can pre-build: reads and writes against the
 * fixture's own rows. Anything else (a service call, a substrate op) has no pre-built answer, so the workload
 * is reported as an error rather than timed on a made-up reply.
 */
class FloorHost {
  private readonly rows: EntityRows;
  private minted = 0;

  constructor(fixture: ScenarioFixture) {
    this.rows = seedRows(fixture);
  }

  private table(entityType: string): EntityRow[] {
    const rows = this.rows.get(entityType) ?? [];
    this.rows.set(entityType, rows);
    return rows;
  }

  answer(request: IoRequestWire): IoAnswerWire {
    switch (request.kind) {
      case 'listRows':
        return { kind: 'rows', result: ok(this.table(request.entityType).map((row) => rowCopy(row))) };
      case 'readRow':
        return { kind: 'row', result: ok(rowValue(this.table(request.entityType).find((row) => row.id === request.id))) };
      case 'createRow': {
        const data = typeof request.data === 'object' && request.data !== null && !Array.isArray(request.data) ? request.data : {};
        this.minted += 1;
        const row: EntityRow = { ...structuredClone(data), id: typeof data.id === 'string' ? data.id : `floor-${this.minted}` };
        this.table(request.entityType).push(row);
        return { kind: 'row', result: ok(rowValue(row)) };
      }
      case 'writeRow': {
        const table = this.table(request.entityType);
        const at = table.findIndex((row) => row.id === request.id);
        if (at === -1) return { kind: 'row', result: { error: `no ${request.entityType} row "${request.id}"` } };
        const data = typeof request.data === 'object' && request.data !== null && !Array.isArray(request.data) ? request.data : {};
        table[at] = { ...table[at], ...structuredClone(data), id: request.id };
        return { kind: 'row', result: ok(rowValue(table[at])) };
      }
      case 'deleteRow': {
        const table = this.table(request.entityType);
        const at = table.findIndex((row) => row.id === request.id);
        if (at !== -1) table.splice(at, 1);
        return { kind: 'deleted', result: ok(null) };
      }
      default:
        throw new Error(`the floor recorder has no pre-built answer for a "${request.kind}" request`);
    }
  }
}

function decode(text: string, where: string): ServerProgressWire {
  const progress: ServerProgressWire = JSON.parse(text);
  if (progress.status === 'done' && progress.response.error !== undefined) throw new Error(`${where}: ${progress.response.error}`);
  return progress;
}

function startRequest(step: ScenarioStep): string {
  return JSON.stringify({ event: step.event, payload: step.payload ?? {}, targetTrait: step.trait });
}

function newServer(module: FloorKernelModule, schemaJson: string): FloorServer {
  const server = new module.Server(schemaJson);
  server.setDefaultUser(DEFAULT_VIEWER);
  return server;
}

/** Runs the scenario once on a throwaway server, answering from the fixture's rows, and keeps every string that crossed. */
export function recordScenario(module: FloorKernelModule, fixture: ScenarioFixture, scenario: Scenario, schemaJson: string): RecordedStep[] {
  const server = newServer(module, schemaJson);
  const host = new FloorHost(fixture);
  try {
    return scenario.steps.map((step): RecordedStep => {
      const where = `${step.trait}.${step.event}`;
      const crossings: Crossing[] = [];
      const input = startRequest(step);
      let output = server.start(scenario.orbital, input);
      crossings.push({ kind: 'start', flight: 0, input, output });
      let progress = decode(output, where);
      while (progress.status === 'await') {
        const replies: IoReplyWire[] = progress.requests.map((pending) => ({ id: pending.id, answer: host.answer(pending.request) }));
        const repliesJson = JSON.stringify(replies);
        output = server.resume(progress.flight, repliesJson);
        crossings.push({ kind: 'resume', flight: progress.flight, input: repliesJson, output });
        progress = decode(output, where);
      }
      return { step, crossings };
    });
  } finally {
    server.free();
  }
}

/** A second server replays the recording; each reply must lead to the same kind of progress, so a timed replay does the recorded work. */
export function verifyRecording(module: FloorKernelModule, scenario: Scenario, schemaJson: string, recording: readonly RecordedStep[]): void {
  const server = newServer(module, schemaJson);
  try {
    for (const { step, crossings } of recording) {
      const where = `${step.trait}.${step.event}`;
      for (const [i, crossing] of crossings.entries()) {
        const output = crossing.kind === 'start' ? server.start(scenario.orbital, crossing.input) : server.resume(crossing.flight, crossing.input);
        const progress = decode(output, where);
        const last = i === crossings.length - 1;
        if ((progress.status === 'done') !== last) throw new Error(`${where}: the replay diverged from the recording at crossing ${i + 1}`);
      }
    }
  } finally {
    server.free();
  }
}

export interface RecordedScenario {
  recording: RecordedStep[];
  schemaJson: string;
}

/** Records and verifies each scenario once; the floor rows share the result. */
export class FloorRecorder {
  private readonly schemas = new WeakMap<ScenarioFixture, string>();
  private readonly recordings = new WeakMap<Scenario, RecordedStep[]>();

  schemaJson(fixture: ScenarioFixture): string {
    let json = this.schemas.get(fixture);
    if (json === undefined) {
      json = JSON.stringify(fixture.schema);
      this.schemas.set(fixture, json);
    }
    return json;
  }

  record(module: FloorKernelModule, fixture: ScenarioFixture, scenario: Scenario): RecordedScenario {
    const schemaJson = this.schemaJson(fixture);
    let recording = this.recordings.get(scenario);
    if (recording === undefined) {
      recording = recordScenario(module, fixture, scenario, schemaJson);
      verifyRecording(module, scenario, schemaJson, recording);
      this.recordings.set(scenario, recording);
    }
    return { recording, schemaJson };
  }
}
