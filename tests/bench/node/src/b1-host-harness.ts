import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toPayloadValue, type EventResponse } from '@almadar/core';
import type { EmitRecord, JsonValue, Scenario, ScenarioFixture, ScenarioHarness, ScenarioSession, ScenarioStep, TraceStep } from './types.js';

function toJson(value: object | null): JsonValue {
  return toPayloadValue(value);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      const { port } = address;
      probe.close(() => resolvePort(port));
    });
  });
}

class HostSession implements ScenarioSession {
  constructor(
    private readonly base: string,
    private readonly orbital: string,
    private readonly child: ChildProcess,
    private readonly dir: string,
  ) {}

  async dispatch(step: ScenarioStep): Promise<TraceStep> {
    const reply = await fetch(`${this.base}/api/orbitals/${encodeURIComponent(this.orbital)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: step.event, payload: step.payload ?? {}, targetTrait: step.trait }),
    });
    const response: EventResponse = await reply.json();
    if (!reply.ok || response.error !== undefined) throw new Error(`${step.trait}.${step.event}: ${response.error ?? reply.status}`);
    const states: Record<string, string> = { ...(response.states ?? {}) };
    if (!(step.trait in states)) throw new Error(`B1-host: trait "${step.trait}" has no state in the response`);
    const emits: EmitRecord[] = response.emittedEvents.map((e) => ({ event: e.event, payload: toJson(e.payload ?? null) }));
    const effects: JsonValue[] = (response.clientEffectsByTrait ?? []).map((frame) => toJson(frame.effect));
    return { trait: step.trait, event: step.event, states, effects, emits };
  }

  async close(): Promise<void> {
    this.child.kill();
    await new Promise((done) => this.child.once('exit', done));
    await rm(this.dir, { recursive: true, force: true });
  }
}

/**
 * B1-host: the native `orb serve` server as its own process, driven over a loopback HTTP socket by this Node process. The only
 * Node in the loop is the driver, so the row prices the server and the socket, not an interpreter. `ORB_BIN` names the binary;
 * `ALMADAR_HOST_CWD` is where it resolves the language packages (a monorepo checkout). The store is the in-memory one with no
 * sample rows and no emulators start.
 */
export class B1HostHarness implements ScenarioHarness {
  readonly id = 'B1-host';
  readonly name = 'orb serve (native server, loopback socket)';
  readonly measuredPackages = [] as const;
  readonly runtimeLabel = 'native process';

  constructor(
    private readonly orbBin: string | undefined,
    private readonly cwd: string | undefined,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.orbBin !== undefined && this.cwd !== undefined;
  }

  async open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession> {
    if (this.orbBin === undefined || this.cwd === undefined) throw new Error('B1-host: set ORB_BIN and ALMADAR_HOST_CWD');
    const dir = await mkdtemp(join(tmpdir(), 'kernel-bench-host-'));
    const program = join(dir, 'app.orb');
    await writeFile(program, JSON.stringify(fixture.schema));
    const port = await freePort();
    const child = spawn(this.orbBin, ['serve', program, '--port', String(port), '--no-mock', '--no-emulators'], {
      cwd: this.cwd,
      env: { ...process.env, ORB_NO_AUTO_SETUP: '1', NODE_ENV: 'development' },
      stdio: 'ignore',
    });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`B1-host: orb serve exited with ${child.exitCode}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        // the port is not open yet
      }
      if (Date.now() > deadline) {
        child.kill();
        throw new Error('B1-host: orb serve did not answer /api/health in 30 s');
      }
      await new Promise((wait) => setTimeout(wait, 50));
    }
    return new HostSession(base, scenario.orbital, child, dir);
  }
}

export function createB1HostHarness(orbBin: string | undefined, cwd: string | undefined): B1HostHarness {
  return new B1HostHarness(orbBin, cwd);
}
