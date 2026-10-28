import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseOrbitalSchema, type OrbitalSchema } from '@almadar/core';

const lowered = new Map<string, OrbitalSchema>();
const lockDir = join(tmpdir(), 'almadar-client-program.lock');

function holderAlive(): boolean {
  try {
    process.kill(Number(readFileSync(join(lockDir, 'pid'), 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
}

/** Concurrent `orb compile` runs return each other's programs (orb defect, reported), so every test process compiles one program at a time. */
function compileExclusively<T>(compile: () => T): T {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'pid'), String(process.pid));
      break;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      if (!holderAlive()) rmSync(lockDir, { recursive: true, force: true });
      Atomics.wait(wait, 0, 0, 25);
    }
  }
  try {
    return compile();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/** A `.lolo` program (with any files beside it, such as `locales/en/<app>.json`) as the installed `orb` compiles it for a browser kernel: the stamp, `_metadata.protocols` and dispatch facts included. */
export function clientProgram(source: string, files: Readonly<Record<string, string>> = {}): OrbitalSchema {
  const bin = process.env.ORB_BIN;
  if (bin === undefined || bin === '') throw new Error('clientProgram: set ORB_BIN to the installed orb binary that lowers the test programs');
  const key = JSON.stringify([source, files]);
  const known = lowered.get(key);
  if (known !== undefined) return structuredClone(known);
  const dir = mkdtempSync(join(tmpdir(), 'client-program-'));
  try {
    const file = join(dir, 'program.lolo');
    writeFileSync(file, source);
    const served = join(dir, 'out/packages/client/public');
    for (const [path, text] of Object.entries(files)) {
      // `orb compile` validates the emitted client program again where it will be served, so the files sit there too.
      for (const target of [join(dir, path), join(served, path)]) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
      }
    }
    const schema = compileExclusively(() => {
      execFileSync(bin, ['compile', file, '-o', join(dir, 'out'), '--mode', 'client'], { cwd: dir, stdio: 'pipe' });
      return parseOrbitalSchema(JSON.parse(readFileSync(join(served, 'program.client.orb'), 'utf8')));
    });
    lowered.set(key, schema);
    return structuredClone(schema);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
