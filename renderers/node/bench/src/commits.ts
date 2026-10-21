import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execa } from 'execa';

export interface CommitOptions {
  /** package name -> sha, wins over everything. */
  shas?: Record<string, string>;
  /** package name -> directory to run `git rev-parse HEAD` in. */
  dirs?: Record<string, string>;
}

export type CommitRecord = { sha: string } | { sha: null; reason: string };

interface Manifest {
  name?: string;
}

function packageDir(name: string): string {
  const require = createRequire(import.meta.url);
  let dir = dirname(require.resolve(name));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed: Manifest = JSON.parse(readFileSync(manifest, 'utf8'));
      if (parsed.name === name) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no package.json named ${name} above ${dirname(require.resolve(name))}`);
    dir = parent;
  }
}

async function headOf(dir: string): Promise<CommitRecord> {
  const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir, reject: false });
  if (result.exitCode !== 0) return { sha: null, reason: `git rev-parse HEAD failed in ${dir}: ${result.stderr}` };
  return { sha: result.stdout.trim() };
}

export async function resolveCommits(packages: readonly string[], options: CommitOptions = {}): Promise<Record<string, CommitRecord>> {
  const out: Record<string, CommitRecord> = {};
  for (const name of packages) {
    const given = options.shas?.[name];
    if (given !== undefined) {
      out[name] = { sha: given };
      continue;
    }
    let dir = options.dirs?.[name];
    if (dir === undefined) {
      try {
        dir = packageDir(name);
      } catch (error) {
        out[name] = { sha: null, reason: `cannot locate ${name}: ${error instanceof Error ? error.message : String(error)}; pass --commit ${name}=<sha>` };
        continue;
      }
    }
    out[name] = await headOf(dir);
  }
  return out;
}
