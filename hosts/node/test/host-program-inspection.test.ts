import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgramInspectionSchema } from '@almadar/core';
import { runProgramEffect } from '../src/program/index.js';

const orb = process.env['ORB_BIN'] ?? join(process.env['HOME'] ?? '', 'bin', 'orb');
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const source = `app inspection-twin [version: "1.0.0"]
;; 🌱 original editor buffer
orbital Hello {
  entity Greeting [runtime] {
    id : string!
  }
  trait Greet -> Greeting [interaction] {
    initial: idle
    state idle {
      INIT -> idle
        (render-ui main { type: "typography", content: "hi" })
    }
  }
  page "/" -> Greet
}
`;

describe.skipIf(!existsSync(orb))('native program inspection host twin', () => {
  it('preserves unsaved source and matches the native envelope', async () => {
    const cwd = mkdtempSync(join(import.meta.dirname, '.tmp-program-inspection-'));
    directories.push(cwd);
    const original = join(cwd, 'original.lolo');
    const input = join(cwd, 'unsaved.lolo');
    writeFileSync(original, 'invalid disk content');
    writeFileSync(input, source);
    const direct = spawnSync(orb, ['emit', 'orb', input, '--inspect-source', original, '--document-version', '31'], { cwd, encoding: 'utf8' });
    expect(direct.status, direct.stderr).toBe(0);
    const expected = ProgramInspectionSchema.parse(JSON.parse(direct.stdout));
    const out = await runProgramEffect('program/read', [source, { inspect: true, path: original, version: 31 }], { cwd, orbBin: orb });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual(expected);
    expect(expected.sourceMap.find((a) => a.pointer.endsWith('.stateMachine.transitions[0]'))).toMatchObject({ path: original, exact: true });
  });

  it('refuses a fabricated relative original location', async () => {
    const out = await runProgramEffect('program/read', [source, { inspect: true, path: 'relative.lolo', version: 31 }], { cwd: import.meta.dirname, orbBin: orb });
    expect(out).toMatchObject({ ok: false, error: 'program/read inspect: path must be the original absolute .lolo path' });
  });
});
