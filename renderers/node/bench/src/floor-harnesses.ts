import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { DEFAULT_VIEWER } from './kernel-trace.js';
import { FloorRecorder, type FloorKernelModule, type FloorServer, type FloorWasm, type RecordedStep } from './floor-recording.js';
import type { MemorySample, Scenario, ScenarioFixture, ScenarioHarness, ScenarioSession, ScenarioStep, TraceStep } from './types.js';

interface Loaded {
  module: FloorKernelModule;
  wasm: FloorWasm;
  loadMs: number;
}

async function loadKernel(dir: string): Promise<Loaded> {
  const start = performance.now();
  const module: FloorKernelModule = await import(pathToFileURL(join(dir, 'pkg/orbital_wasm.js')).href);
  const wasm = module.initSync({ module: await readFile(join(dir, 'pkg/orbital_wasm_bg.wasm')) });
  return { module, wasm, loadMs: performance.now() - start };
}

/** A floor row's trace is empty on purpose: the row times a part of the work, so nothing is compared. */
function floorStep(step: ScenarioStep): TraceStep {
  return { trait: step.trait, event: step.event, states: {}, effects: [], emits: [] };
}

function recordedByStep(recording: readonly RecordedStep[]): Map<ScenarioStep, RecordedStep> {
  return new Map(recording.map((r) => [r.step, r]));
}

function recordedFor(byStep: ReadonlyMap<ScenarioStep, RecordedStep>, step: ScenarioStep, row: string): RecordedStep {
  const recorded = byStep.get(step);
  if (recorded === undefined) throw new Error(`${row}: step ${step.trait}.${step.event} is not in the recording`);
  return recorded;
}

abstract class FloorHarness implements ScenarioHarness {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly measuredPackages = ['@almadar/kernel'] as const;
  readonly ungated = true as const;
  moduleLoadMs?: number;
  protected loaded: Loaded | null = null;
  protected readonly recorder = new FloorRecorder();

  constructor(private readonly kernelDir: string | undefined) {}

  async isAvailable(): Promise<boolean> {
    if (this.kernelDir === undefined) return false;
    try {
      this.loaded = await loadKernel(this.kernelDir);
      this.moduleLoadMs = this.loaded.loadMs;
      return true;
    } catch {
      return false;
    }
  }

  protected kernel(): Loaded {
    if (this.loaded === null) throw new Error(`${this.id}: @almadar/kernel is not available (ALMADAR_KERNEL_DIR)`);
    return this.loaded;
  }

  abstract open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession>;
}

class F2Session implements ScenarioSession {
  lastDispatchMs = 0;
  openMs = 0;
  /** Keeps each reply string live so nothing is elided; it is never parsed. */
  lastOutput = '';
  private readonly dispatched = new Set<ScenarioStep>();

  constructor(
    private readonly server: FloorServer,
    private readonly wasm: FloorWasm,
    private readonly orbital: string,
    private readonly byStep: ReadonlyMap<ScenarioStep, RecordedStep>,
  ) {}

  async dispatch(step: ScenarioStep): Promise<TraceStep> {
    const recorded = recordedFor(this.byStep, step, 'F2');
    if (this.dispatched.has(step)) throw new Error('F2 replays each recorded step once per session; a flight id is only valid for that one conversation');
    this.dispatched.add(step);
    const start = performance.now();
    for (const crossing of recorded.crossings) {
      this.lastOutput = crossing.kind === 'start' ? this.server.start(this.orbital, crossing.input) : this.server.resume(crossing.flight, crossing.input);
    }
    this.lastDispatchMs = performance.now() - start;
    return floorStep(step);
  }

  async sampleMemory(): Promise<MemorySample> {
    return { heapUsedBytes: process.memoryUsage().heapUsed + this.wasm.memory.buffer.byteLength, rssBytes: process.memoryUsage().rss };
  }

  async close(): Promise<void> {
    this.server.free();
  }
}

/**
 * F2: the kernel's compute inside WebAssembly with the input already built. The server-role `Server` is driven with
 * the exact request and host-reply strings a recording pass captured (so no JS-side decode, answer building or
 * serialization is timed) and its replies are never parsed. The strings still cross as JSON, so the kernel's own JSON
 * decode and encode are inside this number until the crossing carries structured values (speed pass 2, step 4).
 */
export class F2Harness extends FloorHarness {
  readonly id = 'F2';
  readonly name = 'floor: kernel compute in WASM, input pre-built (Node)';

  async open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession> {
    const { module, wasm } = this.kernel();
    const { recording, schemaJson } = this.recorder.record(module, fixture, scenario);
    const start = performance.now();
    const server = new module.Server(schemaJson);
    server.setDefaultUser(DEFAULT_VIEWER);
    const session = new F2Session(server, wasm, scenario.orbital, recordedByStep(recording));
    session.openMs = performance.now() - start;
    return session;
  }
}

interface PreparedCrossing {
  inputText: string;
  inputBytes: number;
  outputPtr: number;
  outputBytes: number;
}

class F3Session implements ScenarioSession {
  lastDispatchMs = 0;
  openMs = 0;
  /** Keeps each decoded string live so nothing is elided. */
  lastOutput = '';
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly wasm: FloorWasm,
    private readonly prepared: ReadonlyMap<ScenarioStep, readonly PreparedCrossing[]>,
  ) {}

  async dispatch(step: ScenarioStep): Promise<TraceStep> {
    const crossings = this.prepared.get(step);
    if (crossings === undefined) throw new Error(`F3: step ${step.trait}.${step.event} is not in the recording`);
    const start = performance.now();
    for (const crossing of crossings) {
      const ptr = this.wasm.__wbindgen_malloc(crossing.inputBytes, 1);
      this.encoder.encodeInto(crossing.inputText, new Uint8Array(this.wasm.memory.buffer, ptr, crossing.inputBytes));
      this.wasm.__wbindgen_free(ptr, crossing.inputBytes, 1);
      this.lastOutput = this.decoder.decode(new Uint8Array(this.wasm.memory.buffer, crossing.outputPtr, crossing.outputBytes));
    }
    this.lastDispatchMs = performance.now() - start;
    return floorStep(step);
  }

  async sampleMemory(): Promise<MemorySample> {
    return { heapUsedBytes: process.memoryUsage().heapUsed + this.wasm.memory.buffer.byteLength, rssBytes: process.memoryUsage().rss };
  }

  async close(): Promise<void> {
    for (const crossings of this.prepared.values()) for (const c of crossings) this.wasm.__wbindgen_free(c.outputPtr, c.outputBytes, 1);
  }
}

/**
 * F3: the boundary alone. For every crossing F2 makes, the same number of bytes is copied into the module's memory
 * the way wasm-bindgen passes a string in, and the same number is decoded out of it the way a returned string is
 * read; the kernel does no work. The byte counts come from the recording pass, so the sizes are the real ones.
 */
export class F3Harness extends FloorHarness {
  readonly id = 'F3';
  readonly name = 'floor: boundary only, same payload sizes (Node)';

  async open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession> {
    const { module, wasm } = this.kernel();
    const { recording } = this.recorder.record(module, fixture, scenario);
    const encoder = new TextEncoder();
    const prepared = new Map<ScenarioStep, PreparedCrossing[]>();
    for (const { step, crossings } of recording) {
      prepared.set(step, crossings.map((crossing): PreparedCrossing => {
        const inputBytes = encoder.encode(crossing.input).length;
        const outputBytes = encoder.encode(crossing.output).length;
        const outputPtr = wasm.__wbindgen_malloc(outputBytes, 1);
        new Uint8Array(wasm.memory.buffer, outputPtr, outputBytes).fill(0x61);
        return { inputText: 'a'.repeat(inputBytes), inputBytes, outputPtr, outputBytes };
      }));
    }
    return new F3Session(wasm, prepared);
  }
}

export function createF2Harness(kernelDir: string | undefined): F2Harness {
  return new F2Harness(kernelDir);
}

export function createF3Harness(kernelDir: string | undefined): F3Harness {
  return new F3Harness(kernelDir);
}
