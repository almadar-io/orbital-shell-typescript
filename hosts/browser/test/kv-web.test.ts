import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, vi, describe, expect, it } from 'vitest';
import type { JsonValue } from '@almadar/core';
import { createKvWebPort, kvDatabaseName, kvNamespace, type KvHostPort, type KvOp } from '../src/kv.js';

let factory: IDBFactory;
const open = (locale = 'en', app = 'shop', allows?: Parameters<typeof createKvWebPort>[0]['allows']): KvHostPort =>
  createKvWebPort({ app, locale, factory, allows });

async function ok(port: KvHostPort, op: KvOp, args: JsonValue[]): Promise<JsonValue> {
  const settled = await port.answer(op, args);
  if (!('ok' in settled)) throw new Error(`${op} failed: ${settled.error.kind} ${settled.error.message}`);
  return settled.ok;
}

beforeEach(() => {
  factory = new IDBFactory();
});

describe('kv-web', () => {
  it('names the namespace', () => {
    expect(kvNamespace('shop', 'en', 'rows')).toBe('kv:shop:en:rows');
    expect(kvDatabaseName('shop', 'en')).toBe('kv:shop:en');
  });

  it('get misses as data, then hits after put', async () => {
    const port = open();
    expect(await ok(port, 'kv/get', ['rows', 'order/1'])).toEqual({ found: false });
    expect(await ok(port, 'kv/put', ['rows', 'order/1', { id: '1', n: [1, null] }])).toEqual({ storedKey: 'order/1' });
    expect(await ok(port, 'kv/get', ['rows', 'order/1'])).toEqual({ found: true, value: { id: '1', n: [1, null] } });
    expect(await ok(port, 'kv/put', ['rows', 'null', null])).toEqual({ storedKey: 'null' });
    expect(await ok(port, 'kv/get', ['rows', 'null'])).toEqual({ found: true, value: null });
  });

  it('delete reports existed', async () => {
    const port = open();
    await ok(port, 'kv/put', ['rows', 'a', 1]);
    expect(await ok(port, 'kv/delete', ['rows', 'a'])).toEqual({ existed: true });
    expect(await ok(port, 'kv/delete', ['rows', 'a'])).toEqual({ existed: false });
    expect(await ok(port, 'kv/get', ['rows', 'a'])).toEqual({ found: false });
  });

  it('scan isolates the prefix, sorts by key and honours limit', async () => {
    const port = open();
    for (const key of ['order/2', 'order-line/1', 'order/1', 'orders/9']) await ok(port, 'kv/put', ['rows', key, key]);
    expect(await ok(port, 'kv/scan', ['rows', 'order/'])).toEqual({
      entries: [{ key: 'order/1', value: 'order/1' }, { key: 'order/2', value: 'order/2' }],
    });
    expect(await ok(port, 'kv/scan', ['rows', 'order/', 1])).toEqual({ entries: [{ key: 'order/1', value: 'order/1' }] });
    expect(await ok(port, 'kv/scan', ['rows', 'order/', 0])).toEqual({ entries: [] });
    for (const bad of [-1, 1.5, '2', { limit: 1 }]) {
      expect(await port.answer('kv/scan', ['rows', 'order/', bad])).toMatchObject({ error: { kind: 'invalid' } });
    }
    const all = await ok(port, 'kv/scan', ['rows', '']);
    expect(all).toEqual({ entries: ['order-line/1', 'order/1', 'order/2', 'orders/9'].map((key) => ({ key, value: key })) });
  });

  it('batch applies puts and deletes in one transaction', async () => {
    const port = open();
    await ok(port, 'kv/put', ['rows', 'old', 1]);
    const applied = await ok(port, 'kv/batch', ['rows', [
      { kind: 'put', key: 'a', value: 1 },
      { kind: 'put', key: 'b', value: { x: 2 } },
      { kind: 'delete', key: 'old' },
    ]]);
    expect(applied).toEqual({ applied: 3 });
    expect(await ok(port, 'kv/scan', ['rows', ''])).toEqual({ entries: [{ key: 'a', value: 1 }, { key: 'b', value: { x: 2 } }] });
  });

  it('batch with one invalid op changes nothing', async () => {
    const port = open();
    await ok(port, 'kv/put', ['rows', 'keep', 'v']);
    const settled = await port.answer('kv/batch', ['rows', [
      { kind: 'put', key: 'new', value: 1 },
      { kind: 'delete', key: 'keep' },
      { kind: 'put', key: 'bad', value: Number.NaN },
    ]]);
    expect(settled).toEqual({ error: { kind: 'invalid', message: expect.stringContaining('JSON') } });
    expect(await ok(port, 'kv/scan', ['rows', ''])).toEqual({ entries: [{ key: 'keep', value: 'v' }] });
  });

  it('isolates locales of one app, and stores of one locale', async () => {
    const en = open('en');
    const ar = open('ar');
    await ok(en, 'kv/put', ['rows', 'k', 'english']);
    await ok(en, 'kv/put', ['other', 'k', 'other-store']);
    expect(await ok(ar, 'kv/get', ['rows', 'k'])).toEqual({ found: false });
    await ok(ar, 'kv/put', ['rows', 'k', 'arabic']);
    expect(await ok(en, 'kv/get', ['rows', 'k'])).toEqual({ found: true, value: 'english' });
    expect(await ok(en, 'kv/get', ['other', 'k'])).toEqual({ found: true, value: 'other-store' });
    expect(await ok(open('en', 'other-app'), 'kv/get', ['rows', 'k'])).toEqual({ found: false });
  });

  it('a port whose locale is read per ask answers each ask from the database of the locale current then', async () => {
    let locale = 'en';
    const port = createKvWebPort({ app: 'shop', locale: () => locale, factory });
    await ok(port, 'kv/put', ['rows', 'k', 'english']);
    locale = 'ar';
    expect(await ok(port, 'kv/get', ['rows', 'k'])).toEqual({ found: false });
    await ok(port, 'kv/put', ['rows', 'k', 'arabic']);
    expect(await ok(open('ar'), 'kv/get', ['rows', 'k'])).toEqual({ found: true, value: 'arabic' });
    locale = 'en';
    expect(await ok(port, 'kv/get', ['rows', 'k'])).toEqual({ found: true, value: 'english' });
  });

  it('control: a fixed locale keeps one database', async () => {
    const port = open('en');
    await ok(port, 'kv/put', ['rows', 'k', 'english']);
    expect(await ok(port, 'kv/get', ['rows', 'k'])).toEqual({ found: true, value: 'english' });
    expect(await ok(open('ar'), 'kv/get', ['rows', 'k'])).toEqual({ found: false });
  });

  it('answers concurrent calls on two stores of one database, the second store added while the first is busy', async () => {
    const port = open();
    await ok(port, 'kv/put', ['answers', 'seed', 1]);
    const settled = await Promise.all([
      port.answer('kv/put', ['answers', 'a', 'one']),
      port.answer('kv/get', ['prefetched', '__index']),
      port.answer('kv/put', ['prefetched', 'p', 'path']),
      port.answer('kv/put', ['answers', 'b', 'two']),
    ]);
    expect(settled).toEqual([{ ok: { storedKey: 'a' } }, { ok: { found: false } }, { ok: { storedKey: 'p' } }, { ok: { storedKey: 'b' } }]);
    expect(await ok(port, 'kv/get', ['prefetched', 'p'])).toEqual({ found: true, value: 'path' });
  });

  it('adds a store while another port holds the same database open, and that port keeps answering', async () => {
    const first = open();
    const second = open();
    await ok(first, 'kv/put', ['answers', 'k', 'v']);
    await ok(second, 'kv/put', ['prefetched', 'p', 'path']);
    expect(await ok(first, 'kv/get', ['answers', 'k'])).toEqual({ found: true, value: 'v' });
    expect(await ok(first, 'kv/get', ['prefetched', 'p'])).toEqual({ found: true, value: 'path' });
  });

  it('adds a store while another connection closes only later (blocked), and later stores still open', async () => {
    const port = open();
    await ok(port, 'kv/put', ['answers', 'k', 'v']);
    const other = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(kvDatabaseName('shop', 'en'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    other.onversionchange = () => setTimeout(() => other.close(), 30);
    expect(await ok(port, 'kv/put', ['themes', 'theme', 'arabesque-dark'])).toEqual({ storedKey: 'theme' });
    expect(await ok(port, 'kv/put', ['prefetched', 'p', 'path'])).toEqual({ storedKey: 'p' });
    expect(await ok(port, 'kv/get', ['themes', 'theme'])).toEqual({ found: true, value: 'arabesque-dark' });
  });

  it('control: one store on one port opens once and answers in order', async () => {
    const port = open();
    const settled = await Promise.all([port.answer('kv/put', ['rows', 'a', 1]), port.answer('kv/get', ['rows', 'a'])]);
    expect(settled).toEqual([{ ok: { storedKey: 'a' } }, { ok: { found: true, value: 1 } }]);
  });

  it('refuses bad requests and honours grants, close and no-IndexedDB', async () => {
    const denied = open('en', 'shop', (need) => need.mode === 'read');
    expect(await ok(denied, 'kv/get', ['rows', 'k'])).toEqual({ found: false });
    expect(await denied.answer('kv/put', ['rows', 'k', 1])).toEqual({ error: { kind: 'denied', message: expect.any(String) } });
    expect(await denied.answer('kv/put', ['', 'k', 1])).toEqual({ error: { kind: 'invalid', message: expect.any(String) } });
    const closed = open();
    closed.close();
    expect(await closed.answer('kv/get', ['rows', 'k'])).toEqual({ error: { kind: 'closed', message: expect.any(String) } });
    vi.stubGlobal('indexedDB', undefined);
    try {
      const bare = createKvWebPort({ app: 'a', locale: 'en' });
      expect(await bare.answer('kv/get', ['rows', 'k'])).toEqual({ error: { kind: 'unsupported', message: expect.any(String) } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defer delivers once, refuses a duplicate key and drops a cancelled key', async () => {
    const port = open();
    if (!port.defer || !port.cancel) throw new Error('defer/cancel missing');
    const delivered: string[] = [];
    expect(port.defer('kv/put', ['rows', 'k', 1], 'one', () => delivered.push('one'))).toEqual({ ok: null });
    expect(port.defer('kv/put', ['rows', 'k', 2], 'one', () => delivered.push('dup'))).toEqual({ error: { kind: 'invalid', message: expect.any(String) } });
    expect(port.defer('kv/get', ['rows', 'k'], 'two', () => delivered.push('two'))).toEqual({ ok: null });
    expect(port.cancel('two')).toBe(true);
    expect(port.cancel('nope')).toBe(false);
    await ok(port, 'kv/get', ['rows', 'k']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(delivered).toEqual(['one']);
  });

  it('replays the shared twin trace', async () => {
    const trace = JSON.parse(readFileSync(new URL('./fixtures/kv-trace.json', import.meta.url), 'utf8')) as {
      app: string;
      locale: string;
      steps: Array<{ op: KvOp; args: JsonValue[]; expect?: JsonValue; expectError?: string }>;
    };
    const port = open(trace.locale, trace.app);
    for (const step of trace.steps) {
      const settled = await port.answer(step.op, step.args);
      if (step.expectError !== undefined) expect('error' in settled && settled.error.kind, JSON.stringify(step)).toBe(step.expectError);
      else expect(settled, JSON.stringify(step)).toEqual({ ok: step.expect });
    }
  });
});
