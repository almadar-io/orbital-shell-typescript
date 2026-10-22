/**
 * The one `orb` binary resolver every host calls (G-CROSS-261, the editor's language server too since G-EXTENSIONS-004):
 * `ORB_BIN`, else the `@almadar/orb` installed for the caller's directory. Nothing else is consulted. A set `ORB_BIN`
 * that does not exist is refused by name, never skipped.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehaviorPackageError, resolveOrbBinary } from '../src/behavior-package';

const KEYS = ['PATH', 'HOME', 'ORB_BIN', 'ORBITAL_BIN'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let dir = '';
let home = '';
let project = '';
let onPath = '';

function binary(path: string): string {
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
}

function installOrbPackage(): string {
  const pkg = join(project, 'node_modules', '@almadar', 'orb');
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@almadar/orb', bin: { orb: 'bin/orb.js' } }));
  return binary(join(pkg, 'bin', 'orb.js'));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orb-binary-'));
  home = join(dir, 'home');
  project = join(dir, 'project');
  const pathDir = join(dir, 'path');
  for (const d of [join(home, 'bin'), project, pathDir]) mkdirSync(d, { recursive: true });
  onPath = binary(join(pathDir, 'orb'));
  process.env.PATH = `${pathDir}:/usr/bin:/bin`;
  process.env.HOME = home;
  delete process.env.ORB_BIN;
  delete process.env.ORBITAL_BIN;
});

afterEach(() => {
  for (const k of KEYS) {
    const value = saved[k];
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveOrbBinary', () => {
  it('ORB_BIN, when set and present, wins over the installed @almadar/orb', () => {
    process.env.ORB_BIN = binary(join(dir, 'orb-a'));
    installOrbPackage();
    expect(resolveOrbBinary(project)).toBe(process.env.ORB_BIN);
  });

  it('edge: ORB_BIN set to a missing path is refused by name, not skipped for the installed package', () => {
    process.env.ORB_BIN = join(dir, 'missing');
    installOrbPackage();
    expect(() => resolveOrbBinary(project)).toThrow(/ORB_BIN/);
  });

  it('the @almadar/orb installed for the caller directory is used, found from a nested directory', () => {
    const installed = installOrbPackage();
    const nested = join(project, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(resolveOrbBinary(nested)).toBe(installed);
  });

  it('a string manifest bin is honoured', () => {
    const pkg = join(project, 'node_modules', '@almadar', 'orb');
    mkdirSync(join(pkg, 'cli'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@almadar/orb', bin: 'cli/run.js' }));
    const cli = binary(join(pkg, 'cli', 'run.js'));
    expect(resolveOrbBinary(project)).toBe(cli);
  });

  it('edge: nothing set and nothing installed is an error naming both sources', () => {
    expect(() => resolveOrbBinary(project)).toThrow(BehaviorPackageError);
    expect(() => resolveOrbBinary(project)).toThrow(/set ORB_BIN or install @almadar\/orb/);
  });

  it('control: an orb on PATH is NOT picked up', () => {
    expect(onPath).not.toBe('');
    expect(() => resolveOrbBinary(project)).toThrow(/ORB_BIN/);
  });

  it('control: ~/bin/orb is NOT picked up', () => {
    binary(join(home, 'bin', 'orb'));
    expect(() => resolveOrbBinary(project)).toThrow(/ORB_BIN/);
  });

  it('control: ORBITAL_BIN is no longer read', () => {
    process.env.ORBITAL_BIN = binary(join(dir, 'orb-b'));
    expect(() => resolveOrbBinary(project)).toThrow(/ORB_BIN/);
  });
});
