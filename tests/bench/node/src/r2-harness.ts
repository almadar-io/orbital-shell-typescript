import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { bundleSizes } from './kernel-bundle.js';
import { dispatchTraceStep, DEFAULT_VIEWER, KERNEL_CLIENT_ID, orbitalTraitNames, type KernelHandle } from './kernel-trace.js';
import type { ColdStartSample, HarnessMeasurements, MemorySample, Scenario, ScenarioFixture, ScenarioHarness, ScenarioSession, ScenarioStep, TraceStep } from './types.js';

const execFileAsync = promisify(execFile);

interface WasmExports {
  memory: { buffer: { byteLength: number } };
}

interface KernelModule {
  Kernel: new (resolvedSchemaJson: string, clientId: string) => KernelHandle;
  initSync(input: { module: Buffer }): WasmExports;
}

interface Loaded {
  module: KernelModule;
  wasm: WasmExports;
  loadMs: number;
}

class R2Session implements ScenarioSession {
  lastDispatchMs = 0;
  openMs = 0;
  constructor(
    private readonly kernel: KernelHandle,
    private readonly wasm: WasmExports,
    private readonly traitNames: readonly string[],
  ) {}

  async dispatch(step: ScenarioStep): Promise<TraceStep> {
    const start = performance.now();
    const traced = dispatchTraceStep(this.kernel, this.traitNames, step);
    this.lastDispatchMs = performance.now() - start;
    return traced;
  }

  async sampleMemory(): Promise<MemorySample> {
    const usage = process.memoryUsage();
    return { heapUsedBytes: usage.heapUsed + this.wasm.memory.buffer.byteLength, rssBytes: usage.rss };
  }

  async close(): Promise<void> {
    this.kernel.free();
  }
}

const COLD_START_SCRIPT = `
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const { dir, schema, trait, event, payload, orbitalTraits } = JSON.parse(process.env.R2_COLD);
const t0 = performance.now();
const mod = await import(new URL('pkg/orbital_wasm.js', 'file://' + dir + '/').href);
mod.initSync({ module: readFileSync(dir + '/pkg/orbital_wasm_bg.wasm') });
const t1 = performance.now();
const kernel = new mod.Kernel(JSON.stringify(schema), 'bench');
kernel.setCurrentUser('${DEFAULT_VIEWER}');
const t2 = performance.now();
kernel.dispatch(trait, undefined, event, JSON.stringify(payload));
for (const name of orbitalTraits) kernel.getState(name, 'singleton');
const t3 = performance.now();
console.log(JSON.stringify({ moduleLoadMs: t1 - t0, initMs: t2 - t1, firstDispatchMs: t3 - t2, totalMs: t3 - t0 }));
`;

/** R2: `@almadar/kernel` (the client-role EmbeddedKernel as WebAssembly) loaded in Node. */
export class R2Harness implements ScenarioHarness {
  readonly id = 'R2';
  readonly name = '@almadar/kernel WASM (Node)';
  readonly measuredPackages = ['@almadar/kernel'] as const;
  moduleLoadMs?: number;
  private loaded: Loaded | null = null;

  constructor(private readonly kernelDir: string | undefined) {}

  async isAvailable(): Promise<boolean> {
    if (this.kernelDir === undefined) return false;
    try {
      this.loaded = await this.load(this.kernelDir);
      this.moduleLoadMs = this.loaded.loadMs;
      return true;
    } catch {
      return false;
    }
  }

  private async load(dir: string): Promise<Loaded> {
    const start = performance.now();
    const module: KernelModule = await import(pathToFileURL(join(dir, 'pkg/orbital_wasm.js')).href);
    const wasm = module.initSync({ module: await readFile(join(dir, 'pkg/orbital_wasm_bg.wasm')) });
    return { module, wasm, loadMs: performance.now() - start };
  }

  async open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession> {
    if (this.loaded === null && !(await this.isAvailable())) throw new Error('R2: @almadar/kernel is not available');
    const loaded = this.loaded;
    if (loaded === null) throw new Error('R2: @almadar/kernel is not available');
    const start = performance.now();
    const kernel = new loaded.module.Kernel(JSON.stringify(fixture.schema), KERNEL_CLIENT_ID);
    kernel.setCurrentUser(DEFAULT_VIEWER);
    const session = new R2Session(kernel, loaded.wasm, orbitalTraitNames(fixture, scenario));
    session.openMs = performance.now() - start;
    return session;
  }

  async measure(fixtures: ScenarioFixture[], coldStartFixtures: readonly string[], runs: number): Promise<HarnessMeasurements> {
    const dir = this.kernelDir;
    if (dir === undefined) throw new Error('R2: no kernel directory');
    const coldStart: HarnessMeasurements['coldStart'] = [];
    for (const name of coldStartFixtures) {
      const fixture = fixtures.find((f) => f.name === name);
      if (fixture === undefined) throw new Error(`R2: cold-start fixture "${name}" not found`);
      const scenario = fixture.scenarios[0];
      const first = scenario.steps[0];
      const env = {
        ...process.env,
        R2_COLD: JSON.stringify({ dir, schema: fixture.schema, trait: first.trait, event: first.event, payload: first.payload ?? {}, orbitalTraits: orbitalTraitNames(fixture, scenario) }),
      };
      const samples: ColdStartSample[] = [];
      for (let i = 0; i < runs; i++) {
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', COLD_START_SCRIPT], { env, maxBuffer: 1 << 20 });
        samples.push(JSON.parse(stdout));
      }
      coldStart.push({ fixture: fixture.name, scenario: scenario.name ?? `${first.trait}.${first.event}`, samples });
    }
    return { bundle: await bundleSizes(dir), coldStart };
  }
}

export function createR2Harness(kernelDir: string | undefined): R2Harness {
  return new R2Harness(kernelDir);
}
