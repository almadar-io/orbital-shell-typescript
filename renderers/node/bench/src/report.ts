import { median } from './bench.js';
import type { BenchResult, WorkloadResult } from './bench.js';

export const ROW_ORDER = ['R0', 'R0-client', 'R1', 'R2', 'R3', 'B1-kernel'] as const;

const NOT_MEASURED = 'not measured';

function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

function mib(bytes: number | null, digits = 1): string {
  return bytes === null ? '-' : fixed(bytes / (1024 * 1024), digits);
}

function failureCell(workload: WorkloadResult): string | null {
  if (workload.status === 'parityFailure' && workload.parityFailure !== undefined) {
    return `PARITY FAILURE (step ${workload.parityFailure.stepIndex + 1}: ${workload.parityFailure.field})`;
  }
  if (workload.status === 'error') return `ERROR (${workload.error ?? 'unknown'})`;
  return null;
}

function orderedRows(results: readonly BenchResult[]): BenchResult[] {
  const known = ROW_ORDER.flatMap((id) => results.filter((r) => r.harness === id));
  const extra = results.filter((r) => !(ROW_ORDER as readonly string[]).includes(r.harness));
  return [...known, ...extra];
}

function table(rows: readonly BenchResult[], workloads: readonly { key: string; label: string }[], cell: (w: WorkloadResult) => string): string {
  const header = `| Row | ${workloads.map((w) => w.label).join(' | ')} |`;
  const rule = `|---|${workloads.map(() => '---').join('|')}|`;
  const byId = new Map(rows.map((r) => [r.harness, r]));
  const ids = [...ROW_ORDER, ...rows.filter((r) => !(ROW_ORDER as readonly string[]).includes(r.harness)).map((r) => r.harness)];
  const lines = ids.map((id) => {
    const result = byId.get(id);
    const cells = workloads.map((w) => {
      const workload = result?.workloads.find((x) => x.key === w.key);
      if (workload === undefined) return NOT_MEASURED;
      return failureCell(workload) ?? cell(workload);
    });
    return `| ${id} | ${cells.join(' | ')} |`;
  });
  return [header, rule, ...lines].join('\n');
}

export function renderReport(results: readonly BenchResult[]): string {
  const seen = new Set<string>();
  for (const r of results) {
    if (seen.has(r.harness)) throw new Error(`two result files for row ${r.harness}`);
    seen.add(r.harness);
  }
  const rows = orderedRows(results);
  const workloads: { key: string; label: string }[] = [];
  for (const r of rows) {
    for (const w of r.workloads) {
      if (!workloads.some((x) => x.key === w.key)) workloads.push({ key: w.key, label: `${w.fixture} / ${w.scenario}` });
    }
  }

  const sections: string[] = ['# Embedded kernel benchmark', ''];
  sections.push('A row counts only when its trace (states, effects, emits, order) equals the reference trace; otherwise the cell is a parity failure and no time is reported.', '');

  sections.push('## Rows', '');
  sections.push('| Row | Implementation | Reference | Node | Platform | CPU | Runs | Commits |', '|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const commits = Object.entries(r.commits)
      .map(([name, c]) => `${name}@${c.sha ?? `unknown (${'reason' in c ? c.reason : ''})`}`)
      .join('<br>');
    const env = r.environment;
    sections.push(`| ${r.harness} | ${r.harnessName} | ${r.reference} | ${env.node} | ${env.platform}/${env.arch} | ${env.cpuModel} x${env.cpuCount}${env.note === '' ? '' : ` (${env.note})`} | ${r.warmupRuns} warm-up + ${r.measuredRuns} measured | ${commits === '' ? 'none' : commits} |`);
  }
  sections.push('');

  sections.push('## Per-event latency, p50 / p99 (ms)', '', table(rows, workloads, (w) => (w.timing === undefined ? NOT_MEASURED : `${fixed(w.timing.eventLatency.p50Ms, 4)} / ${fixed(w.timing.eventLatency.p99Ms, 4)}`)), '');
  sections.push('## Median of run medians (ms), with spread across runs', '', table(rows, workloads, (w) => (w.timing === undefined ? NOT_MEASURED : `${fixed(w.timing.eventLatency.medianOfRunMediansMs, 4)} (${fixed(w.timing.eventLatency.runMedianSpreadMs.min, 4)} to ${fixed(w.timing.eventLatency.runMedianSpreadMs.max, 4)})`)), '');
  sections.push('## Throughput (steps/s)', '', table(rows, workloads, (w) => (w.timing === undefined ? NOT_MEASURED : fixed(w.timing.stepsPerSecond, 0))), '');
  sections.push('## Cold start (ms): module load + init + first dispatch', '', table(rows, workloads, (w) => (w.timing === undefined ? NOT_MEASURED : fixed(w.timing.coldStart.totalMs, 3))), '');
  sections.push('## Memory, heap MiB after mount / after events (RSS MiB in brackets)', '', table(rows, workloads, (w) => {
    if (w.timing === undefined) return NOT_MEASURED;
    const { afterMount, afterEvents, events } = w.timing.memory;
    const after = afterEvents === null ? 'n/a' : `${mib(afterEvents.heapUsedBytes)} [${mib(afterEvents.rssBytes)}] after ${events}`;
    return `${mib(afterMount.heapUsedBytes)} [${mib(afterMount.rssBytes)}] / ${after}`;
  }), '');
  sections.push(...ratioSection(rows, workloads), ...floorSection(rows, workloads), ...bundleSection(rows), ...coldStartSection(rows), ...failureSection(rows));
  return sections.join('\n');
}

const FLOOR_IDS = ['F1', 'F2', 'F3'] as const;

function p50(row: BenchResult | undefined, key: string): number | null {
  const w = row?.workloads.find((x) => x.key === key);
  return w?.timing === undefined ? null : w.timing.eventLatency.p50Ms;
}

function ms(value: number | null): string {
  return value === null ? '-' : fixed(value, 4);
}

function difference(current: number | null, floor: number | null): string {
  return current === null || floor === null ? '-' : fixed(current - floor, 4);
}

function share(part: number | null, whole: number | null): string {
  return part === null || whole === null || whole === 0 ? '-' : `${fixed((part / whole) * 100, 0)}%`;
}

function floorSection(rows: readonly BenchResult[], workloads: readonly { key: string; label: string }[]): string[] {
  const byId = new Map(rows.map((r) => [r.harness, r]));
  if (!FLOOR_IDS.some((id) => byId.has(id))) return [];
  const lines = workloads.map((w) => {
    const r0 = p50(byId.get('R0'), w.key);
    const f1 = p50(byId.get('F1'), w.key);
    const kernel = p50(byId.get('B1-kernel'), w.key);
    const f2 = p50(byId.get('F2'), w.key);
    const f3 = p50(byId.get('F3'), w.key);
    return `| ${w.label} | ${ms(r0)} | ${ms(f1)} | ${difference(r0, f1)} | ${ms(kernel)} | ${ms(f2)} | ${ms(f3)} | ${difference(kernel, f2)} | ${share(f3, f2)} |`;
  });
  return [
    '## Floors: current vs reachable, p50 (ms)', '',
    'F1 is the native kernel with no response building or serialization; F2 is the kernel in WebAssembly with its input pre-built; F3 is the boundary alone for the same byte counts. `native gap` is R0 minus F1; `WASM gap` is B1-kernel minus F2; `boundary share` is F3 over F2.', '',
    '| Workload | R0 | F1 | native gap | B1-kernel | F2 | F3 | WASM gap | boundary share |',
    '|---|---|---|---|---|---|---|---|---|',
    ...lines, '',
  ];
}

const RATIO_BASELINES = ['R0'] as const;

function ratioSection(rows: readonly BenchResult[], workloads: readonly { key: string; label: string }[]): string[] {
  return RATIO_BASELINES.flatMap((id) => ratioTable(rows, workloads, id));
}

function ratioTable(rows: readonly BenchResult[], workloads: readonly { key: string; label: string }[], baselineId: string): string[] {
  const b1 = rows.find((r) => r.harness === baselineId);
  if (b1 === undefined) return [];
  const baseline = new Map<string, number>();
  for (const w of b1.workloads) if (w.timing !== undefined) baseline.set(w.key, w.timing.eventLatency.p50Ms);
  const columns = workloads.filter((w) => baseline.has(w.key));
  const others = rows.filter((r) => r.harness !== baselineId);
  if (columns.length === 0 || others.length === 0) return [];
  const lines = others.map((r) => {
    const ratios: number[] = [];
    const cells = columns.map((c) => {
      const w = r.workloads.find((x) => x.key === c.key);
      const base = baseline.get(c.key);
      if (w === undefined || w.timing === undefined || base === undefined) return '-';
      const ratio = w.timing.eventLatency.p50Ms / base;
      ratios.push(ratio);
      return fixed(ratio, 2);
    });
    return `| ${r.harness} | ${cells.join(' | ')} | ${ratios.length === 0 ? '-' : fixed(median(ratios), 2)} |`;
  });
  return [
    `## p50 ratio to ${baselineId} (above 1 is slower than the native kernel)`, '',
    `| Row | ${columns.map((c) => c.label).join(' | ')} | median |`,
    `|---|${columns.map(() => '---').join('|')}|---|`,
    ...lines, '',
  ];
}

function bundleSection(rows: readonly BenchResult[]): string[] {
  const lines: string[] = [];
  for (const r of rows) {
    for (const f of r.measurements?.bundle ?? []) lines.push(`| ${r.harness} | ${f.file} | ${mib(f.rawBytes, 3)} | ${mib(f.gzipBytes, 3)} | ${mib(f.brotliBytes, 3)} |`);
  }
  if (lines.length === 0) return [];
  return ['## Bundle size (MiB)', '', '| Row | File | Raw | Gzip | Brotli |', '|---|---|---|---|---|', ...lines, ''];
}

function coldStartSection(rows: readonly BenchResult[]): string[] {
  const lines: string[] = [];
  let runs = 0;
  for (const r of rows) {
    for (const c of r.measurements?.coldStart ?? []) {
      const totals = c.samples.map((s) => s.totalMs);
      if (totals.length === 0) continue;
      runs = Math.max(runs, totals.length);
      lines.push(`| ${r.harness} | ${c.fixture} / ${c.scenario} | ${fixed(median(totals), 1)} / ${fixed(Math.max(...totals), 1)} |`);
    }
  }
  if (lines.length === 0) return [];
  return [`## Cold start in fresh runtimes (ms), median / max over ${runs} runs`, '', '| Row | Workload | Module load + init + first dispatch |', '|---|---|---|', ...lines, ''];
}

function failureSection(rows: readonly BenchResult[]): string[] {
  const lines: string[] = [];
  for (const r of rows) {
    for (const w of r.workloads) {
      if (w.status === 'parityFailure' && w.parityFailure !== undefined) {
        lines.push(`| ${r.harness} | ${w.fixture} / ${w.scenario} | ${w.parityFailure.stepIndex + 1} | ${w.parityFailure.field} |`);
      }
    }
  }
  if (lines.length === 0) return [];
  return ['## Parity failures', '', '| Row | Workload | Step | Field |', '|---|---|---|---|', ...lines, ''];
}
