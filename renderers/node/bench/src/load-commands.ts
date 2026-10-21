import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { KernelModule } from '@almadar/shell-web';
import { DEFAULT_CLIENT_COUNTS, formatConcurrencySweep, runConcurrencySweep, type ConcurrencyEngine } from './concurrency-rows.js';
import { formatWriteHeavy, runWriteHeavyRow, WRITE_HEAVY_OPS, WRITE_HEAVY_TABLE_ROWS, type WriteHeavyEngine } from './write-heavy-rows.js';

const PACKAGE_ROOT: string = fileURLToPath(new URL('..', import.meta.url));

export const LOAD_COMMANDS = ['conc', 'write-heavy'] as const;

export const LOAD_HELP = `  conc [--engine js|kernel|both] [--clients 1,8,64,256] [--events 100] [--latency-ms 1] [--interval-ms 0] [--no-pushdown] [--out f.json]
                          Concurrency rows B1-conc / B1-kernel-conc (design 6.1): N clients on one server runtime, throughput, p50/p95/p99, saturation
  write-heavy [--engine js|kernel|both] [--rows 10000] [--ops 10000] [--no-pushdown] [--out f.json]
                          Write-heavy rows B1-write-heavy / B1-kernel-write-heavy (design 6.4): 80% update / 10% create / 10% batch with adapter calls per op
                          The kernel engine needs ALMADAR_KERNEL_DIR.`;

function option(args: readonly string[], name: string): string | undefined {
  const flag = `--${name}`;
  const at = args.indexOf(flag);
  if (at >= 0 && at + 1 < args.length) return args[at + 1];
  const joined = args.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? undefined : joined.slice(flag.length + 1);
}

function intOption(args: readonly string[], name: string, fallback: number): number {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
  return value;
}

function engines(args: readonly string[]): Array<ConcurrencyEngine & WriteHeavyEngine> {
  const raw = option(args, 'engine') ?? 'kernel';
  if (raw === 'kernel') return [raw];
  throw new Error('--engine must be kernel (the JS engine retired with the interpreter)');
}

async function loadKernel(): Promise<KernelModule> {
  const dir = process.env.ALMADAR_KERNEL_DIR;
  const { loadInstalledKernel, loadKernelModule } = await import('@almadar/shell-node');
  return dir === undefined ? loadInstalledKernel(PACKAGE_ROOT) : loadKernelModule(dir, { languageFrom: PACKAGE_ROOT });
}

/** Runs `conc` or `write-heavy`; returns the printed report, or null when `command` is not a load command. */
export async function loadCommand(command: string, args: readonly string[]): Promise<string | null> {
  if (command !== 'conc' && command !== 'write-heavy') return null;
  const selected = engines(args);
  const pushdown = !args.includes('--no-pushdown');
  const kernel = selected.includes('kernel') ? await loadKernel() : undefined;
  const sections: string[] = [];
  const data: object[] = [];
  for (const engine of selected) {
    if (command === 'conc') {
      const clients = (option(args, 'clients') ?? DEFAULT_CLIENT_COUNTS.join(',')).split(',').map(Number);
      const sweep = await runConcurrencySweep(
        { engine, pushdown, ...(kernel !== undefined ? { kernel } : {}), eventsPerClient: intOption(args, 'events', 100), latencyMs: intOption(args, 'latency-ms', 1), arrivalIntervalMs: intOption(args, 'interval-ms', 0) },
        clients,
      );
      sections.push(formatConcurrencySweep(sweep));
      data.push(sweep);
    } else {
      const result = await runWriteHeavyRow({ engine, pushdown, ...(kernel !== undefined ? { kernel } : {}), tableRows: intOption(args, 'rows', WRITE_HEAVY_TABLE_ROWS), ops: intOption(args, 'ops', WRITE_HEAVY_OPS) });
      sections.push(formatWriteHeavy(result));
      data.push(result);
    }
  }
  const out = option(args, 'out');
  if (out !== undefined) await writeFile(out, JSON.stringify(data, null, 2));
  return sections.join('\n\n');
}
