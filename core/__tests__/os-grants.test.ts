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

  it('carries mem, kernel, ffi, gpu and credentials through a union with {} on either side', () => {
    const held: OsGrants = {
      mem: [{ target: 'arena:a', kinds: ['create'] }],
      kernel: [{ target: 'queue:q', kinds: ['read'] }],
      ffi: [{ library: 'libm', symbol: 'cos', signature: '(f64)->f64' }],
      gpu: [{ target: 'device:1024', kinds: ['open'] }],
      credentials: ['admin'],
    };
    expect(unionOsGrants(held, {})).toEqual(held);
    expect(unionOsGrants({}, held)).toEqual(held);
    expect(unionOsGrants(held, undefined)).toEqual(held);
  });

  it('unions mem, kernel and gpu kinds per target and ffi and credentials without duplicates, as the Rust OsGrants::union', () => {
    const a: OsGrants = {
      mem: [{ target: 'arena:a', kinds: ['create'] }],
      kernel: [{ target: 'queue:q', kinds: ['read'] }],
      ffi: [{ library: 'libm', symbol: 'cos', signature: '(f64)->f64' }],
      gpu: [{ target: 'device:1024', kinds: ['open'] }],
      credentials: ['admin'],
    };
    const b: OsGrants = {
      mem: [{ target: 'arena:a', kinds: ['free', 'create'] }, { target: 'arena:b', kinds: ['atomic'] }],
      kernel: [{ target: 'queue:q', kinds: ['spawn'] }],
      ffi: [{ library: 'libm', symbol: 'cos', signature: '(f64)->f64' }, { library: 'libm', symbol: 'sin', signature: '(f64)->f64' }],
      gpu: [{ target: 'device:1024', kinds: ['compute', 'open'] }, { target: 'device:2048', kinds: ['render'] }],
      credentials: ['admin'],
    };
    expect(unionOsGrants(a, b)).toEqual({
      mem: [{ target: 'arena:a', kinds: ['create', 'free'] }, { target: 'arena:b', kinds: ['atomic'] }],
      kernel: [{ target: 'queue:q', kinds: ['read', 'spawn'] }],
      ffi: [{ library: 'libm', symbol: 'cos', signature: '(f64)->f64' }, { library: 'libm', symbol: 'sin', signature: '(f64)->f64' }],
      gpu: [{ target: 'device:1024', kinds: ['open', 'compute'] }, { target: 'device:2048', kinds: ['render'] }],
      credentials: ['admin'],
    });
  });

  it('control: a family neither side declares stays absent', () => {
    expect(unionOsGrants({ mem: [{ target: 'arena:a', kinds: ['create'] }] }, { exec: ['ls'] })).toEqual({ mem: [{ target: 'arena:a', kinds: ['create'] }], exec: ['ls'] });
  });
});
