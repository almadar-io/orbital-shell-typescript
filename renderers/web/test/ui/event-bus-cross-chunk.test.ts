/**
 * EventBus cross-chunk singleton guard.
 *
 * The EventBus is the one channel every trait state machine, ServerBridge
 * re-broadcast, and `<Button action="X">` host emits through. For a
 * `<EventBusProvider>` mounted from one entry point to reach a `useEventBus()`
 * consumer rendered from another, BOTH must reference the SAME React
 * `EventBusContext` object — a single module instance shared across chunks.
 *
 * Any entry whose code imports `EventBusContext` WITHOUT the
 * `dedupe-event-bus-context` / `dedupe-providers` plugins bundles its OWN
 * `createContext(null)` — a second, unrelated context (always so for the CJS
 * files, which are built one self-contained file per entry). A Provider from one
 * chunk then never reaches a consumer from another: cross-chunk emits land on
 * a dead bus and the runtime logs `emit:no-listeners`. This is invisible to a
 * behavioural `emit → on` test, which runs against SOURCE where only one copy
 * of the context exists — the split exists only in the built, chunk-split
 * dist. So this guard asserts the invariant on the build OUTPUT.
 *
 * Real regression this caught (2026-06-12): the `avl` build was missing the
 * dedupe plugins the main build has, so the canvas (FlowCanvas → OrbPreview →
 * ServerBridge, all bundled into `dist/avl`) ran on its own EventBusContext.
 * Entity-list traits emitted `*Loaded` into a bus no host listener was on, so
 * the lists never left `loading` — the canvas showed a perpetual spinner while
 * the Run tab (on `dist/runtime`, correctly deduped) worked.
 *
 * The ESM entries share chunks, so each entry is checked with every chunk it
 * statically imports.
 *
 * Requires `npm run build` first — it reads `dist/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../package.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

// The ESM dist file backing each subpath export.
function distFor(subpath: string): string {
  const entry = (pkg as { exports: Record<string, { import?: string } | string> }).exports[subpath];
  const rel = typeof entry === 'string' ? entry : entry?.import;
  if (!rel) throw new Error(`no import export for "${subpath}"`);
  return resolve(root, rel);
}

// `createContext` for the bus, tolerant of esbuild's `/* @__PURE__ */` marker
// and the numeric suffix tsup appends on collision (`EventBusContext2`).
const DEFINES_CONTEXT = /EventBusContext\d*\s*=\s*(?:\/\*[^*]*\*\/\s*)?(?:React\.)?createContext/;

// Every bus-consuming entry reaches the ONE chunk that defines EventBusContext; none inlines its own.
const BUS_CONSUMERS = ['./core', './components', './providers', './avl', './runtime', './hooks'];

const RELATIVE_STATIC_IMPORT = /(?:^|[;\n])\s*(?:import|export)\s*(?:[\w{},*\s$]+from\s*)?['"](\.{1,2}\/[^'"]+\.js)['"]/g;

/** The entry's file plus every chunk it statically imports, transitively. */
function closure(subpath: string): Map<string, string> {
  const pending = [distFor(subpath)];
  const files = new Map<string, string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    if (!existsSync(file)) {
      throw new Error(`${file} missing — run \`pnpm build\` before this test`);
    }
    const text = readFileSync(file, 'utf8');
    files.set(file, text);
    for (const m of text.matchAll(RELATIVE_STATIC_IMPORT)) pending.push(resolve(dirname(file), m[1]));
  }
  return files;
}

function definingFiles(subpath: string): string[] {
  return [...closure(subpath)].filter(([, text]) => DEFINES_CONTEXT.test(text)).map(([file]) => file);
}

describe('EventBusContext is a cross-chunk singleton', () => {
  it('every bus-consuming entry reaches exactly one defining chunk, the same one', () => {
    const homes = new Set<string>();
    for (const sub of BUS_CONSUMERS) {
      const defining = definingFiles(sub);
      expect(defining, `${sub} must reach exactly one EventBusContext`).toHaveLength(1);
      homes.add(defining[0]);
    }
    expect([...homes]).toHaveLength(1);
  });

  it('control: the check reads the chunks an entry imports, not just its own file', () => {
    const own = readFileSync(distFor('./components'), 'utf8');
    expect(closure('./components').size).toBeGreaterThan(1);
    expect(DEFINES_CONTEXT.test(own)).toBe(false);
  });
});
