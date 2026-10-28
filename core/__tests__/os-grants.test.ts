/**
 * The TS `OsGrants` mirror pinned to the Rust serde shape (`OsGrants` in
 * `orbital-core/crates/base/src/host/os_grants/mod.rs`): every family the kernel serializes
 * round-trips, and a family the mirror lacks fails loudly instead of being stripped.
 */
import { describe, it, expect } from 'vitest';
import { OsGrantsSchema, unionOsGrants, type OsGrants } from '../src/types/index.js';

const full: OsGrants = {
  fs: [{ glob: '/tmp/*', modes: ['read', 'meta'] }],
  exec: ['ls'],
  net: [{ target: 'a:1', kinds: ['tcp'] }],
  env: ['HOME'],
  stdio: ['out'],
  sys: ['cpu'],
  desktop: ['notify'],
  dev: [{ target: 'irq:3', kinds: ['wait'] }],
  kv: { 'cache-*': ['read', 'write'] },
  anchored: {
    fs: [{ anchor: 'exe-dir', glob: 'data/**', modes: ['read'] }],
    exec: [{ anchor: { env: 'TOOL' } }, { anchor: 'cwd', path: 'bin/x' }],
    net: [{ host: { literal: 'h' }, port: { anchor: { env: 'PORT' } }, kinds: ['listen'] }],
  },
};

describe('OsGrantsSchema mirrors the Rust OsGrants', () => {
  it('round-trips every family, kv and anchored included', () => {
    expect(OsGrantsSchema.parse(full)).toEqual(full);
  });

  it('control: an unknown family is refused, not stripped', () => {
    expect(OsGrantsSchema.safeParse({ ...full, bogus: [] }).success).toBe(false);
  });

  it('control: an unknown kv mode and anchor are refused', () => {
    expect(OsGrantsSchema.safeParse({ kv: { s: ['delete'] } }).success).toBe(false);
    expect(OsGrantsSchema.safeParse({ anchored: { fs: [{ anchor: 'home', glob: 'x', modes: [] }] } }).success).toBe(false);
  });

  it('unions kv modes per store and anchored entries without duplicates', () => {
    const merged = unionOsGrants({ kv: { s: ['read'] }, anchored: full.anchored }, { kv: { s: ['write'], t: ['read'] }, anchored: full.anchored });
    expect(merged.kv).toEqual({ s: ['read', 'write'], t: ['read'] });
    expect(merged.anchored).toEqual(full.anchored);
    expect(unionOsGrants(undefined, undefined)).toEqual({});
  });
});
