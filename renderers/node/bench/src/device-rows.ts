import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Hand-run rows (design section 6.2): the C ABI under load on the lowest supported iOS and Android device.
 * They are not ScenarioHarness rows: no host-side Node process can drive them, so they are not registered.
 */
export interface DeviceWorkload {
  id: string;
  description: string;
}

export interface DeviceRow {
  id: 'R1-device-ios' | 'R1-device-android';
  platform: 'ios' | 'android';
  library: string;
  makeTarget: string;
  deviceScript: string;
  benchScript: string;
  runInstructions: string[];
  workloads: DeviceWorkload[];
  gates: string[];
  missing: string[];
}

const WORKLOADS: DeviceWorkload[] = [
  { id: 'dispatch-1e4', description: '10^4 events through orbital_kernel_dispatch from the UI thread; per-call latency.' },
  { id: 'frame-60hz-100', description: '60 Hz orbital_kernel_frame loop with 100 ticking traits (orbital_kernel_tick_count); kernel time per frame, dropped frames.' },
  { id: 'frame-60hz-1000', description: 'Same with 1 000 ticking traits.' },
  { id: 'sustained-5min', description: '5-minute sustained run; p50 of first and last minute (thermal throttling).' },
];

const GATES = [
  'kernel time per frame <= 2 ms at 1 000 ticks (planning number)',
  'zero outstanding strings (orbital_kernel_outstanding_strings)',
  'footprint slope over last 80% of run <= 8 bytes per event, sampled every 1 000 events',
  'idle frame allocates nothing (counting-allocator unit test)',
];

export const DEVICE_ROWS: readonly DeviceRow[] = [
  {
    id: 'R1-device-ios',
    platform: 'ios',
    library: 'orbital-rust/target/aarch64-apple-ios-sim/release/liborbital_ffi.a',
    makeTarget: 'ios-lib (simulator) / ios-lib-device',
    deviceScript: 'orbital-rust/scripts/native/ios-device.sh',
    benchScript: 'orbital-rust/crates/orbital-shell-ios/tests/device-bench/run.sh',
    runInstructions: [
      'pnpm --dir orbital-rust/crates/orbital-shell-typescript/renderers/node/bench exec tsx src/cli.ts gen-device-workloads --out <dir> --fixtures orbital-rust/crates/orbital-core/crates/runtime/tests/fixtures/parity --tick-schema orbital-rust/crates/orbital-ffi/tests/fixtures/resolved/tick-counter.json',
      '(cd orbital-rust && make ios-lib && scripts/native/ios-device.sh boot)',
      'orbital-rust/crates/orbital-shell-ios/tests/device-bench/run.sh <dir> [--sustained]',
    ],
    workloads: WORKLOADS,
    gates: GATES,
    missing: [
      'iOS device (not simulator) run: make ios-lib-device and a signed host; the simulator host is the only one wired',
      'footprint slope and idle-frame allocation gates (the host reports p50/p95, dropped frames and outstanding strings only)',
    ],
  },
  {
    id: 'R1-device-android',
    platform: 'android',
    library: 'orbital-rust/target/jniLibs/arm64-v8a/liborbital_ffi.so',
    makeTarget: 'android-lib',
    deviceScript: 'orbital-rust/scripts/native/android-device.sh',
    benchScript: 'orbital-rust/crates/orbital-shell-android/tests/device-bench/run.sh',
    runInstructions: [
      'pnpm --dir orbital-rust/crates/orbital-shell-typescript/renderers/node/bench exec tsx src/cli.ts gen-device-workloads --out <dir> --fixtures orbital-rust/crates/orbital-core/crates/runtime/tests/fixtures/parity --tick-schema orbital-rust/crates/orbital-ffi/tests/fixtures/resolved/tick-counter.json',
      '(cd orbital-rust && make android-lib && scripts/native/android-device.sh boot)',
      'orbital-rust/crates/orbital-shell-android/tests/device-bench/run.sh <dir> [--sustained]',
    ],
    workloads: [...WORKLOADS, { id: 'jni-vs-c-abi', description: 'Same event workload through jni_kernel_bridge.rs against the raw C ABI, to isolate JString conversion.' }],
    gates: GATES,
    missing: [
      'the Kotlin host (Bench.kt) is written but has never been compiled or run: kotlinc, ANDROID_HOME (d8, android.jar), adb and an AVD (ORB_AVD, default orbital-test) are needed',
      'cargo-ndk is installed; ANDROID_NDK_HOME is unset, so android-lib has not been built',
      'jni-vs-c-abi: the host times only the JNI path; the raw C ABI comparison needs a native executable under adb',
      'footprint slope and idle-frame allocation gates (the host reports p50/p95, dropped frames and outstanding strings only)',
    ],
  },
];

function hasCommand(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0;
}

export interface DeviceAvailability {
  id: DeviceRow['id'];
  toolchain: boolean;
  benchScript: boolean;
  runnable: boolean;
  reason: string;
}

/** `runnable` means the platform toolchain is present and the bench script exists; `reason` is the first thing still missing. */
export function deviceAvailability(
  rows: readonly DeviceRow[] = DEVICE_ROWS,
  has: (command: string, args: string[]) => boolean = hasCommand,
  scriptExists: (path: string) => boolean = existsSync,
): DeviceAvailability[] {
  return rows.map((row) => {
    const toolchain = row.platform === 'ios' ? has('xcrun', ['simctl', 'help']) : has('adb', ['version']) && has('kotlinc', ['-version']);
    const benchScript = scriptExists(row.benchScript);
    const reason = !benchScript ? `bench script ${row.benchScript} is missing` : !toolchain ? `${row.platform} toolchain is not on PATH` : (row.missing[0] ?? '');
    return { id: row.id, toolchain, benchScript, runnable: toolchain && benchScript, reason };
  });
}
