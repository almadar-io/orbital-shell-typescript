import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonValue } from '@almadar/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createKvHost, directoryKvBackend, memoryKvBackend, type KvBackend, type KvHost, type KvNamespace, type KvResult } from '../src/index.js';

const ns: KvNamespace = { app: 'shop', locale: 'en', store: 'rows' };
const roots: string[] = [];

function directoryIgnoresPermissions(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'kv-perm-'));
  try {
    chmodSync(probe, 0o500);
    writeFileSync(join(probe, 'x'), '');
    return true;
  } catch {
    return false;
  } finally {
    chmodSync(probe, 0o700);
    rmSync(probe, { recursive: true, force: true });
  }
}

function data<T>(r: KvResult<T>): T {
  if (!r.ok) throw new Error(`${r.kind}: ${r.error}`);
  return r.value;
}

async function dirBackend(): Promise<{ backend: KvBackend; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kv-node-'));
  roots.push(root);
  return { backend: directoryKvBackend(root), root };
}

afterAll(async () => { await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))); });

const backends: Array<[string, () => Promise<KvBackend>]> = [
  ['memory', async () => memoryKvBackend()],
  ['directory', async () => (await dirBackend()).backend],
];

describe.each(backends)('kv on %s', (_name, make) => {
  const host = async (): Promise<KvHost> => createKvHost(await make());

  it('get hit and miss; put then get', async () => {
    const kv = await host();
    expect(data(await kv.get(ns, 'a'))).toEqual({ found: false });
    expect(data(await kv.put(ns, 'a', { n: 1, s: ['x', null, true] }))).toEqual({ key: 'a' });
    expect(data(await kv.get(ns, 'a'))).toEqual({ found: true, value: { n: 1, s: ['x', null, true] } });
    expect(data(await kv.put(ns, 'a', null))).toEqual({ key: 'a' });
    expect(data(await kv.get(ns, 'a'))).toEqual({ found: true, value: null });
  });

  it('delete reports whether the key existed', async () => {
    const kv = await host();
    await kv.put(ns, 'a', 1);
    expect(data(await kv.delete(ns, 'a'))).toEqual({ existed: true });
    expect(data(await kv.delete(ns, 'a'))).toEqual({ existed: false });
    expect(data(await kv.get(ns, 'a'))).toEqual({ found: false });
  });

  it('scan is a sorted prefix scan; order/ never matches order-line/', async () => {
    const kv = await host();
    await kv.batch(ns, [
      { kind: 'put', key: 'order/2', value: 2 },
      { kind: 'put', key: 'order-line/1', value: 9 },
      { kind: 'put', key: 'order/10', value: 10 },
      { kind: 'put', key: 'order/1', value: 1 },
      { kind: 'put', key: 'ordér/1', value: 5 },
    ]);
    expect(data(await kv.scan(ns, 'order/')).entries.map((e) => e.key)).toEqual(['order/1', 'order/10', 'order/2']);
    expect(data(await kv.scan(ns, 'order-line/')).entries.map((e) => e.value)).toEqual([9]);
    expect(data(await kv.scan(ns, 'nothing/')).entries).toEqual([]);
    expect(data(await kv.scan(ns, '')).entries).toHaveLength(5);
  });

  it('scan honours limit', async () => {
    const kv = await host();
    await kv.batch(ns, ['c', 'a', 'b'].map((k) => ({ kind: 'put' as const, key: `p/${k}`, value: k })));
    expect(data(await kv.scan(ns, 'p/', 2)).entries.map((e) => e.key)).toEqual(['p/a', 'p/b']);
    expect(data(await kv.scan(ns, 'p/', 0)).entries).toEqual([]);
    const bad = await kv.scan(ns, 'p/', -1);
    expect(bad.ok).toBe(false);
  });

  it('batch applies puts and deletes together', async () => {
    const kv = await host();
    await kv.put(ns, 'gone', 1);
    expect(data(await kv.batch(ns, [{ kind: 'put', key: 'a', value: 1 }, { kind: 'delete', key: 'gone' }, { kind: 'delete', key: 'never' }]))).toEqual({ applied: 3 });
    expect(data(await kv.get(ns, 'a'))).toEqual({ found: true, value: 1 });
    expect(data(await kv.get(ns, 'gone'))).toEqual({ found: false });
  });

  it('a failed batch leaves the previous state', async () => {
    const kv = await host();
    await kv.put(ns, 'keep', 'v');
    const bad = await kv.batch(ns, [
      { kind: 'put', key: 'new', value: 1 },
      { kind: 'delete', key: 'keep' },
      { kind: 'put', key: 'bad', value: Number.NaN },
    ]);
    expect(bad).toMatchObject({ ok: false, kind: 'invalid' });
    expect(data(await kv.scan(ns, '')).entries).toEqual([{ key: 'keep', value: 'v' }]);
  });

  it('namespaces are isolated by app, locale and store', async () => {
    const kv = await host();
    await kv.put(ns, 'k', 'en');
    expect(data(await kv.get({ ...ns, locale: 'ar' }, 'k'))).toEqual({ found: false });
    expect(data(await kv.get({ ...ns, app: 'other' }, 'k'))).toEqual({ found: false });
    expect(data(await kv.get({ ...ns, store: 'rows-log' }, 'k'))).toEqual({ found: false });
  });

  it('rejects non-JSON values and bad names as invalid', async () => {
    const kv = await host();
    expect(await kv.put(ns, 'k', new Uint8Array(2) as never)).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await kv.get({ ...ns, store: '../x' }, 'k')).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await kv.get(ns, '\ud800')).toMatchObject({ ok: false, kind: 'invalid' });
  });
});

describe('kv directory layout', () => {
  it('is one sorted JSON object per namespace file, portable to a fresh host', async () => {
    const { backend, root } = await dirBackend();
    const kv = createKvHost(backend);
    await kv.batch(ns, [{ kind: 'put', key: 'b"/\n', value: [1] }, { kind: 'put', key: 'a', value: { z: 1 } }]);
    const file = join(root, 'kv', 'shop', 'en', 'rows.json');
    expect(await readFile(file, 'utf8')).toBe('{"a":{"z":1},"b\\"/\\n":[1]}');
    expect(await readdir(join(root, 'kv', 'shop', 'en'))).toEqual(['rows.json']);
    const again = createKvHost(directoryKvBackend(root));
    expect(data(await again.get(ns, 'b"/\n'))).toEqual({ found: true, value: [1] });
  });

  it.skipIf(directoryIgnoresPermissions())('a commit that fails leaves the previous file and no temp file', async () => {
    const { backend, root } = await dirBackend();
    const kv = createKvHost(backend);
    await kv.put(ns, 'a', 1);
    const dir = join(root, 'kv', 'shop', 'en');
    await chmod(dir, 0o500);
    try {
      const failed = await kv.batch(ns, [{ kind: 'put', key: 'b', value: 2 }]);
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.kind).toBe('io');
    } finally {
      await chmod(dir, 0o700);
    }
    expect(data(await kv.scan(ns, '')).entries).toEqual([{ key: 'a', value: 1 }]);
    expect((await readdir(dir)).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});

type TraceStep = { op: string; args: JsonValue[]; expect?: JsonValue; expectError?: string };
const trace = JSON.parse(readFileSync(new URL('../../web/test/fixtures/kv-trace.json', import.meta.url), 'utf8')) as {
  app: string;
  locale: string;
  steps: TraceStep[];
};

async function replay(kv: KvHost, step: TraceStep): Promise<KvResult<JsonValue>> {
  const nsOf = { app: trace.app, locale: trace.locale, store: step.args[0] as string };
  const key = step.args[1] as string;
  switch (step.op) {
    case 'kv/get': return kv.get(nsOf, key);
    case 'kv/put': return kv.put(nsOf, key, step.args[2]);
    case 'kv/delete': return kv.delete(nsOf, key);
    case 'kv/scan': return kv.scan(nsOf, key, typeof step.args[2] === 'number' ? step.args[2] : undefined);
    default: return kv.batch(nsOf, step.args[1] as never);
  }
}

describe.each(backends)('twin trace on %s', (_name, make) => {
  it('replays kv-trace.json with the recorded results', async () => {
    const kv = createKvHost(await make());
    for (const step of trace.steps) {
      const r = await replay(kv, step);
      if (step.expectError !== undefined) expect(r.ok ? 'ok' : r.kind, JSON.stringify(step)).toBe(step.expectError);
      else expect(r.ok ? r.value : r, JSON.stringify(step)).toEqual(step.expect);
    }
  });
});
