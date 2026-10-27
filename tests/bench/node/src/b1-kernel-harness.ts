import { fileURLToPath } from 'node:url';
import type { EventPayload, OrbitalEventResponse } from '@almadar/core';
import type { OrbitalServerRuntime as OrbitalServerRuntimeType } from '@almadar/shell-node/OrbitalServerRuntime';
import type { KernelModule } from '@almadar/shell-web';
import type { EmitRecord, JsonValue, Scenario, ScenarioFixture, ScenarioHarness, ScenarioSession, ScenarioStep, TraceStep } from './types.js';

const PACKAGE_ROOT: string = fileURLToPath(new URL('..', import.meta.url));

declare global {
  var __ALMADAR_DEBUG__: string | undefined;
}

interface Loaded {
  runtime: typeof import('@almadar/shell-node/OrbitalServerRuntime');
  kernel: KernelModule;
}

function toJson(value: EventPayload | object | null): JsonValue {
  return JSON.parse(JSON.stringify(value));
}

function toPayload(value: JsonValue | undefined): EventPayload {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function toTraceStep(step: ScenarioStep, response: OrbitalEventResponse, states: Record<string, string>): TraceStep {
  const emits: EmitRecord[] = response.emittedEvents.map((e) => ({ event: e.event, payload: toJson(e.payload ?? null) }));
  const effects: JsonValue[] = (response.clientEffectsByTrait ?? []).map((frame) => toJson(frame.effect));
  return { trait: step.trait, event: step.event, states, effects, emits };
}

class B1KernelSession implements ScenarioSession {
  constructor(
    private readonly runtime: OrbitalServerRuntimeType,
    private readonly orbital: string,
  ) {}

  async dispatch(step: ScenarioStep): Promise<TraceStep> {
    const response = await this.runtime.processOrbitalEvent(this.orbital, {
      event: step.event,
      payload: toPayload(step.payload),
      targetTrait: step.trait,
    });
    if (response.error !== undefined) throw new Error(`${step.trait}.${step.event}: ${response.error}`);
    const after = this.runtime.getState(this.orbital) ?? {};
    const states: Record<string, string> = {};
    for (const [trait, traitState] of Object.entries(after)) states[trait] = traitState.currentState;
    if (!(step.trait in states)) {
      throw new Error(`B1-kernel: trait "${step.trait}" has no state under orbital "${this.orbital}"`);
    }
    return toTraceStep(step, response, states);
  }

  async close(): Promise<void> {
    this.runtime.unregisterAll();
  }
}

/**
 * B1-kernel: `@almadar/runtime`'s `OrbitalServerRuntime` on the Rust kernel in WebAssembly (its I/O answered by the
 * runtime's persistence) in Node: the given kernel build, else the kernel `@almadar/runtime` installs. The reference
 * for its traces is R0, the native server-role kernel. (B1, the same runtime on its installed kernel, merged in here
 * once the runtime became kernel-only.)
 */
export class B1KernelHarness implements ScenarioHarness {
  readonly id: string;
  readonly name: string;
  readonly measuredPackages = ['@almadar/runtime', '@almadar/kernel'] as const;
  private loaded: Loaded | null = null;

  /** `source` is the built `@almadar/kernel` directory (wasm) or the `kernel.node` add-on file (native). */
  constructor(
    private readonly source: string | undefined,
    private readonly engine: 'wasm' | 'native' = 'wasm',
  ) {
    this.id = engine === 'native' ? 'B1-kernel-native' : 'B1-kernel';
    this.name = engine === 'native' ? '@almadar/runtime on the native kernel add-on (Node)' : '@almadar/runtime on the kernel (Node)';
  }

  async isAvailable(): Promise<boolean> {
    if (this.source === undefined && this.engine === 'native') return false;
    try {
      globalThis.__ALMADAR_DEBUG__ = '';
      const { loadInstalledKernel, loadKernelModule, loadNativeKernelModule } = await import('@almadar/shell-node');
      const source = this.source;
      this.loaded = {
        runtime: await import('@almadar/shell-node/OrbitalServerRuntime'),
        kernel: source === undefined
          ? await loadInstalledKernel(PACKAGE_ROOT)
          : this.engine === 'native' ? await loadNativeKernelModule(source, { languageFrom: PACKAGE_ROOT }) : await loadKernelModule(source, { languageFrom: PACKAGE_ROOT }),
      };
      return true;
    } catch {
      return false;
    }
  }

  async open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession> {
    if (this.loaded === null && !(await this.isAvailable())) throw new Error(`${this.id}: the kernel is not available (ALMADAR_KERNEL_DIR, or ALMADAR_KERNEL_NODE for the native add-on)`);
    const loaded = this.loaded;
    if (loaded === null) throw new Error(`${this.id}: the kernel is not available (ALMADAR_KERNEL_DIR, or ALMADAR_KERNEL_NODE for the native add-on)`);
    const runtime = new loaded.runtime.OrbitalServerRuntime({ debug: false, kernel: loaded.kernel });
    await runtime.register(fixture.schema);
    return new B1KernelSession(runtime, scenario.orbital);
  }
}

export function createB1KernelHarness(kernelDir: string | undefined): B1KernelHarness {
  return new B1KernelHarness(kernelDir);
}

export function createB1KernelNativeHarness(addon: string | undefined): B1KernelHarness {
  return new B1KernelHarness(addon, 'native');
}
