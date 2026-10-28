/**
 * `OsGrants` is generated from the Rust serde shape (`OsGrants` in
 * `orbital-core/crates/base/src/host/os_grants/mod.rs`), so the shape is checked by the compiler and the Rust
 * `kernel_wire_ts` test; here the boundary check passes a full value through and the union merges it.
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

describe('OsGrants (generated from the Rust OsGrants)', () => {
  it('passes every family, kv and anchored included, through the boundary check unchanged', () => {
    expect(OsGrantsSchema.parse(full)).toEqual(full);
  });

  it('control: a non-object is refused', () => {
    expect(OsGrantsSchema.safeParse('fs').success).toBe(false);
    expect(OsGrantsSchema.safeParse([]).success).toBe(false);
  });

  it('unions kv modes per store and anchored entries without duplicates', () => {
    const merged = unionOsGrants({ kv: { s: ['read'] }, anchored: full.anchored }, { kv: { s: ['write'], t: ['read'] }, anchored: full.anchored });
    expect(merged.kv).toEqual({ s: ['read', 'write'], t: ['read'] });
    expect(merged.anchored).toEqual(full.anchored);
    expect(unionOsGrants(undefined, undefined)).toEqual({});
  });
});
