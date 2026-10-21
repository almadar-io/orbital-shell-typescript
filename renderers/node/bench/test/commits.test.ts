import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolveCommits } from '../src/commits.js';

async function scratchRepo(): Promise<{ dir: string; sha: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'commits-'));
  await execa('git', ['init', '-q'], { cwd: dir });
  await execa('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: dir });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return { dir, sha: stdout.trim() };
}

describe('resolveCommits', () => {
  it('reads HEAD from the package directory', async () => {
    const { dir, sha } = await scratchRepo();
    expect(await resolveCommits(['pkg'], { dirs: { pkg: dir } })).toEqual({ pkg: { sha } });
  });

  it('a flag-supplied sha wins over the directory', async () => {
    const { dir } = await scratchRepo();
    expect(await resolveCommits(['pkg'], { dirs: { pkg: dir }, shas: { pkg: 'abc123' } })).toEqual({ pkg: { sha: 'abc123' } });
  });

  it('control: a directory that is not a git repo is a recorded reason, not a guess', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'plain-'));
    const out = await resolveCommits(['pkg'], { dirs: { pkg: plain } });
    expect(out.pkg.sha).toBeNull();
    expect(out.pkg).toMatchObject({ reason: expect.stringContaining('git rev-parse HEAD failed') });
  });

  it('control: an unresolvable package without a flag names the flag to pass', async () => {
    const out = await resolveCommits(['@almadar-io/definitely-not-installed']);
    expect(out['@almadar-io/definitely-not-installed']).toMatchObject({ sha: null, reason: expect.stringContaining('--commit') });
  });
});

describe('resolveCommits without flags', () => {
  it('locates an installed package through its entry point and reads a 40-hex sha', async () => {
    const out = await resolveCommits(['@almadar/runtime']);
    expect(out['@almadar/runtime']).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
  });
});
