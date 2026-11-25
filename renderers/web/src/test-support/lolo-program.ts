import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrbitalSchema, type OrbitalSchema } from '@almadar/core';
import { readDefsJson } from '@almadar/shell-runtime/kernel/blobs';

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
  // The dev build (`make install-dev`), as the LSP tests read it; ORB_BIN names another.
  const bin = process.env.ORB_BIN !== undefined && process.env.ORB_BIN !== '' ? process.env.ORB_BIN : join(homedir(), 'bin', 'orb-dev');
  const key = JSON.stringify([source, files]);
  const known = lowered.get(key);
  if (known !== undefined) return structuredClone(known);
  // Under the package (its ignored node_modules cache), so the orb it runs resolves this workspace's @almadar/core, not an installed release.
  const scratch = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '.cache', 'client-program');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'client-program-'));
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
      return parseOrbitalSchema(readDefsJson(readFileSync(join(served, 'program.client.orb'), 'utf8')));
    });
    lowered.set(key, schema);
    return structuredClone(schema);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
