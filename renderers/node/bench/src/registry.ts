import { createB1KernelHarness, createB1KernelNativeHarness } from './b1-kernel-harness.js';
import { createB1HostHarness } from './b1-host-harness.js';
import { createR2Harness } from './r2-harness.js';
import { createR3Harness } from './r3-harness.js';
import { createF2Harness, createF3Harness } from './floor-harnesses.js';
import type { ScenarioHarness } from './types.js';

export type HarnessFactory = () => ScenarioHarness;

const factories = new Map<string, HarnessFactory>([
  ['B1-kernel', () => createB1KernelHarness(process.env.ALMADAR_KERNEL_DIR)],
  ['B1-kernel-native', () => createB1KernelNativeHarness(process.env.ALMADAR_KERNEL_NODE)],
  ['B1-host', () => createB1HostHarness(process.env.ORB_BIN, process.env.ALMADAR_HOST_CWD)],
  ['R2', () => createR2Harness(process.env.ALMADAR_KERNEL_DIR)],
  ['R3', () => createR3Harness(process.env.ALMADAR_KERNEL_DIR, process.env.ALMADAR_PLAYWRIGHT_CORE_DIR)],
  ['F2', () => createF2Harness(process.env.ALMADAR_KERNEL_DIR)],
  ['F3', () => createF3Harness(process.env.ALMADAR_KERNEL_DIR)],
]);

/** Rows built outside this package (R0, R1 are Rust benches) add JSON; R2 and R3 register here; bench and report code never name a row. */
export function registerHarness(id: string, factory: HarnessFactory): void {
  if (factories.has(id)) throw new Error(`harness "${id}" is already registered`);
  factories.set(id, factory);
}

export function registeredHarnessIds(): string[] {
  return [...factories.keys()];
}

export function createHarnessById(id: string): ScenarioHarness {
  const factory = factories.get(id);
  if (factory === undefined) {
    throw new Error(`unknown harness "${id}"; registered: ${registeredHarnessIds().join(', ')}`);
  }
  return factory();
}
