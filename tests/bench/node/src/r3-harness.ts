import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { bundleSizes } from './kernel-bundle.js';
import { CHROMIUM_ARGS, ISOLATION_HEADERS, loadPlaywright, type PlaywrightBrowser, type PlaywrightPage } from './playwright.js';
import { DEFAULT_VIEWER, KERNEL_CLIENT_ID, orbitalTraitNames } from './kernel-trace.js';
import type { ColdStartSample, HarnessMeasurements, MemorySample, Scenario, ScenarioFixture, ScenarioHarness, ScenarioSession, ScenarioStep, TraceStep } from './types.js';

/**
 * The page the kernel runs in. Every call returns a JSON string, and times itself with the page's own
 * clock, so a CDP round trip is never part of a latency. `dispatch` mirrors `dispatchTraceStep`
 * (kernel-trace.ts): one dispatch, one `getState` per trait of the orbital, the same trace shape.
 */
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>kernel</title><script type="module">
const viewer = ${JSON.stringify(DEFAULT_VIEWER)};
const handles = new Map();
let nextId = 1;
let wasm = null;
let mod = null;
window.__r3 = {
  async load() {
    const t0 = performance.now();
    mod = await import('/pkg/orbital_wasm.js');
    wasm = await mod.default({ module_or_path: '/pkg/orbital_wasm_bg.wasm' });
    return JSON.stringify({ loadMs: performance.now() - t0, isolated: crossOriginIsolated });
  },
  open(schemaJson, clientId, traitNames) {
    const t0 = performance.now();
    const kernel = new mod.Kernel(schemaJson, clientId);
    kernel.setCurrentUser(viewer);
    const id = nextId++;
    handles.set(id, { kernel, traitNames });
    return JSON.stringify({ id, openMs: performance.now() - t0 });
  },
  dispatch(id, trait, event, payloadJson) {
    const { kernel, traitNames } = handles.get(id);
    const t0 = performance.now();
    const wire = JSON.parse(kernel.dispatch(trait, undefined, event, payloadJson));
    if (wire.error !== undefined) throw new Error(trait + '.' + event + ': ' + wire.error);
    const states = {};
    for (const name of traitNames) {
      const state = kernel.getState(name, 'singleton');
      if (state !== '') states[name] = state;
    }
    if (!(trait in states)) throw new Error('trait "' + trait + '" has no state after the dispatch');
    const response = wire.response;
    const emits = ((response && response.emittedEvents) || []).map((e) => ({ event: e.event, payload: e.payload === undefined ? null : e.payload }));
    const step = { trait, event, states, effects: ((response && response.clientEffectsByTrait) || []).map((frame) => frame.effect), emits };
    return JSON.stringify({ step, ms: performance.now() - t0 });
  },
  close(id) {
    handles.get(id).kernel.free();
    handles.delete(id);
    return '{}';
  },
  memory() {
    const heap = performance.memory ? performance.memory.usedJSHeapSize : 0;
    return JSON.stringify({ heapUsedBytes: heap + wasm.memory.buffer.byteLength });
  },
};
</script>`;

interface PageServer {
  server: Server;
  origin: string;
}

async function serveKernel(kernelDir: string): Promise<PageServer> {
  const js = gzipSync(await readFile(join(kernelDir, 'pkg/orbital_wasm.js')), { level: 9 });
  const wasm = gzipSync(await readFile(join(kernelDir, 'pkg/orbital_wasm_bg.wasm')), { level: 9 });
  const html = Buffer.from(PAGE_HTML);
  const isolation = ISOLATION_HEADERS;
  const server = createServer((req, res) => {
    if (req.url === '/pkg/orbital_wasm.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'gzip', ...isolation });
      res.end(js);
    } else if (req.url === '/pkg/orbital_wasm_bg.wasm') {
      res.writeHead(200, { 'content-type': 'application/wasm', 'content-encoding': 'gzip', ...isolation });
      res.end(wasm);
    } else if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html', ...isolation });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('R3: page server has no port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

const LAUNCH_ARGS = CHROMIUM_ARGS;

class R3Session implements ScenarioSession {
  lastDispatchMs = 0;
  openMs = 0;
  constructor(
    private readonly page: PlaywrightPage,
    private readonly id: number,
  ) {}

  async dispatch(step: ScenarioStep): Promise<TraceStep> {
    const call = `window.__r3.dispatch(${this.id}, ${JSON.stringify(step.trait)}, ${JSON.stringify(step.event)}, ${JSON.stringify(JSON.stringify(step.payload ?? {}))})`;
    const out: { step: TraceStep; ms: number } = JSON.parse(await this.page.evaluate(call));
    this.lastDispatchMs = out.ms;
    return out.step;
  }

  async sampleMemory(): Promise<MemorySample> {
    const memory: { heapUsedBytes: number } = JSON.parse(await this.page.evaluate('window.__r3.memory()'));
    return { heapUsedBytes: memory.heapUsedBytes, rssBytes: null };
  }

  async close(): Promise<void> {
    await this.page.evaluate(`window.__r3.close(${this.id})`);
  }
}

/** R3: `@almadar/kernel` in headless Chromium, loaded over HTTP from a local server the way a web host would. */
export class R3Harness implements ScenarioHarness {
  readonly id = 'R3';
  readonly name = '@almadar/kernel WASM (headless Chromium)';
  readonly measuredPackages = ['@almadar/kernel'] as const;
  moduleLoadMs?: number;
  runtimeLabel?: string;
  private started: { browser: PlaywrightBrowser; page: PlaywrightPage; served: PageServer } | null = null;

  constructor(
    private readonly kernelDir: string | undefined,
    private readonly playwrightDir: string | undefined,
  ) {}

  async isAvailable(): Promise<boolean> {
    if (this.kernelDir === undefined || this.playwrightDir === undefined) return false;
    if (this.started !== null) return true;
    try {
      const { core, version } = await loadPlaywright(this.playwrightDir);
      const served = await serveKernel(this.kernelDir);
      const browser = await core.chromium.launch({ headless: true, args: LAUNCH_ARGS });
      const page = await browser.newPage();
      await page.goto(`${served.origin}/`);
      const loaded: { loadMs: number; isolated: boolean } = JSON.parse(await page.evaluate('window.__r3.load()'));
      if (!loaded.isolated) throw new Error('R3: page is not cross-origin isolated, so performance.now() is coarsened to 100 us');
      this.moduleLoadMs = loaded.loadMs;
      this.runtimeLabel = `Chromium ${browser.version()} (playwright ${version}, cross-origin isolated timer)`;
      this.started = { browser, page, served };
      return true;
    } catch {
      await this.dispose();
      return false;
    }
  }

  async dispose(): Promise<void> {
    const started = this.started;
    this.started = null;
    if (started === null) return;
    await started.browser.close();
    await new Promise<void>((resolve) => started.served.server.close(() => resolve()));
  }

  async open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession> {
    if (this.started === null && !(await this.isAvailable())) throw new Error('R3: Chromium or @almadar/kernel is not available');
    if (this.started === null) throw new Error('R3: Chromium or @almadar/kernel is not available');
    const { page } = this.started;
    const call = `window.__r3.open(${JSON.stringify(JSON.stringify(fixture.schema))}, ${JSON.stringify(KERNEL_CLIENT_ID)}, ${JSON.stringify(orbitalTraitNames(fixture, scenario))})`;
    const opened: { id: number; openMs: number } = JSON.parse(await page.evaluate(call));
    const session = new R3Session(page, opened.id);
    session.openMs = opened.openMs;
    return session;
  }

  /** Bundle bytes, and cold starts each in its own freshly launched Chromium so no wasm or code cache carries over. */
  async measure(fixtures: ScenarioFixture[], coldStartFixtures: readonly string[], runs: number): Promise<HarnessMeasurements> {
    if (this.kernelDir === undefined || this.playwrightDir === undefined) throw new Error('R3: no kernel or playwright directory');
    const { core } = await loadPlaywright(this.playwrightDir);
    const served = await serveKernel(this.kernelDir);
    const coldStart: HarnessMeasurements['coldStart'] = [];
    try {
      for (const name of coldStartFixtures) {
        const fixture = fixtures.find((f) => f.name === name);
        if (fixture === undefined) throw new Error(`R3: cold-start fixture "${name}" not found`);
        const scenario = fixture.scenarios[0];
        const first = scenario.steps[0];
        const samples: ColdStartSample[] = [];
        for (let i = 0; i < runs; i++) {
          const browser = await core.chromium.launch({ headless: true, args: LAUNCH_ARGS });
          try {
            const page = await browser.newPage();
            await page.goto(`${served.origin}/`);
            const session = new FreshStart(page);
            samples.push(await session.run(fixture, scenario, first));
          } finally {
            await browser.close();
          }
        }
        coldStart.push({ fixture: fixture.name, scenario: scenario.name ?? `${first.trait}.${first.event}`, samples });
      }
    } finally {
      await new Promise<void>((resolve) => served.server.close(() => resolve()));
    }
    return { bundle: await bundleSizes(this.kernelDir), coldStart };
  }
}

class FreshStart {
  constructor(private readonly page: PlaywrightPage) {}

  async run(fixture: ScenarioFixture, scenario: Scenario, first: ScenarioStep): Promise<ColdStartSample> {
    const loaded: { loadMs: number } = JSON.parse(await this.page.evaluate('window.__r3.load()'));
    const opened: { id: number; openMs: number } = JSON.parse(
      await this.page.evaluate(`window.__r3.open(${JSON.stringify(JSON.stringify(fixture.schema))}, ${JSON.stringify(KERNEL_CLIENT_ID)}, ${JSON.stringify(orbitalTraitNames(fixture, scenario))})`),
    );
    const out: { ms: number } = JSON.parse(
      await this.page.evaluate(`window.__r3.dispatch(${opened.id}, ${JSON.stringify(first.trait)}, ${JSON.stringify(first.event)}, ${JSON.stringify(JSON.stringify(first.payload ?? {}))})`),
    );
    return { moduleLoadMs: loaded.loadMs, initMs: opened.openMs, firstDispatchMs: out.ms, totalMs: loaded.loadMs + opened.openMs + out.ms };
  }
}

export function createR3Harness(kernelDir: string | undefined, playwrightDir: string | undefined): R3Harness {
  return new R3Harness(kernelDir, playwrightDir);
}
