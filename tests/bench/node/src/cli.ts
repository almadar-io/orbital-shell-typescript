#!/usr/bin/env node
/**
 * Kernel bench: the benchmark rows of the embedded kernel (wasm in Node and Chromium, the native add-on,
 * the runtime host, `orb host` over a socket), their scenario fixtures and the report that merges them.
 */
import { benchCommand, benchCompareCommand, benchReportCommand, genDeviceWorkloadsCommand, genLargeTableCommand, scenariosCommand } from './commands.js';
import { LOAD_COMMANDS, LOAD_HELP, loadCommand } from './load-commands.js';
import { formatBoundaryRows, runBoundaryMicro } from './f3b-boundary.js';
import { formatWide, runWideTable, seedStore } from './wide-table.js';

const HELP = `
Kernel bench

Usage:
  tsx src/cli.ts <command> [options]

Commands:
  scenarios --harness <id> --fixtures <dir>
                          Run scenario fixtures through a harness and check their expectations
  bench --harness <id> --fixtures <dir> --out <file.json> (--reference <id> | --reference-file <json>)
        [--commit pkg=sha] [--package-dir pkg=dir] [--env-note <text>] [--warmup N] [--runs N] [--memory-events N]
        [--cold-start-fixture <name>]... [--cold-runs N]
                          Time a harness (5 warm-up + 50 measured runs per workload); a run is timed only when its trace equals the reference.
                          Rows: B1-kernel, R2, R3. B1-kernel runs on ALMADAR_KERNEL_DIR, else the installed kernel, and is compared to R0 (--reference-file). R2/R3 need ALMADAR_KERNEL_DIR (the @almadar/kernel package dir); R3 needs
                          ALMADAR_PLAYWRIGHT_CORE_DIR.
                          R0/R1 are Rust benches in orbital-core/orbital-ffi that write the same JSON.
                          F2/F3 are floor rows (WASM compute with pre-built input; the boundary alone): they need ALMADAR_KERNEL_DIR and take no --reference.
                          F1 is the native floor, the orbital-core bench floor_native.
  wide-table [--runs N]   Rows-in-response vs ids-then-resolve on a 40-field table at pages 20/200/1000, through the WASM server role (needs ALMADAR_KERNEL_DIR)
  f3b [--runs N]          Boundary micro row: JSON string vs structured clone vs binary round trips on wire-sized payloads (no kernel)
${LOAD_HELP}
  gen-large-table --out <dir> [--rows 100000] [--seed 20261013]
                          Write the large-table fixtures (100k rows, deterministic) for the bench rows
  gen-device-workloads --out <dir> --fixtures <dir> --tick-schema <resolved.json> [--fixture review-cycle]
                          Write the R1-device workload specs (dispatch loop, 60 Hz frame loops) the Swift and Kotlin bench hosts read
  bench-compare --fixtures <dir> --left <json> --right <json>
                          List, per workload, whether two result files' recorded traces are equal
  bench-report --in <json...> --out <file.md>
                          Merge bench results into a markdown table
`;

async function scenarioCommands(): Promise<boolean> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'bench') {
    const result = await benchCommand(rest);
    for (const w of result.workloads) console.log(`${w.status.padEnd(13)} ${w.key} ${w.fixture} / ${w.scenario}`);
    return true;
  }
  if ((LOAD_COMMANDS as readonly string[]).includes(command)) {
    console.log(await loadCommand(command, rest));
    return true;
  }
  if (command === 'gen-large-table') {
    for (const file of await genLargeTableCommand(rest)) console.log(file);
    return true;
  }
  if (command === 'gen-device-workloads') {
    for (const file of await genDeviceWorkloadsCommand(rest)) console.log(file);
    return true;
  }
  if (command === 'bench-compare') {
    console.log(await benchCompareCommand(rest));
    return true;
  }
  if (command === 'bench-report') {
    await benchReportCommand(rest);
    return true;
  }
  if (command === 'scenarios') {
    const { ran, failures } = await scenariosCommand(rest);
    for (const f of failures) console.log(`FAIL ${f.fixture} ${f.scenario} step ${f.step}: ${f.misses.join('; ')}`);
    console.log(`${ran} scenarios, ${failures.length} failing steps`);
    if (failures.length > 0) process.exitCode = 1;
    return true;
  }
  const runs = (): number => {
    const at = process.argv.indexOf('--runs');
    return at === -1 ? 200 : Number(process.argv[at + 1]);
  };
  if (command === 'f3b') {
    console.log(formatBoundaryRows(runBoundaryMicro({ iterations: runs(), warmup: Math.min(20, runs()) })));
    return true;
  }
  if (command === 'wide-table') {
    const dir = process.env.ALMADAR_KERNEL_DIR;
    if (dir === undefined) throw new Error('wide-table: set ALMADAR_KERNEL_DIR to the built @almadar/kernel directory');
    const { loadKernelModule, nativeMemoryOf } = await import('@almadar/shell-node');
    const kernel = await loadKernelModule(dir, { languageFrom: process.cwd() });
    const store = nativeMemoryOf(kernel);
    await seedStore(store);
    console.log(formatWide(await runWideTable(kernel, store, runs(), Math.min(20, runs()))));
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  try {
    if (await scenarioCommands()) return;
    console.log(HELP);
    process.exitCode = process.argv.length > 2 ? 1 : 0;
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
