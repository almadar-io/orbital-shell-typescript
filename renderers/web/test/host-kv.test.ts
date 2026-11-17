import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@almadar/core';
import type { KvHostPort } from '@almadar/shell-browser/kv';
import { performHostAnswer } from '@almadar/shell-runtime/kernel/host';
import { kvHostAction, registerHostKv, webHostActions } from '../src/lib/host-actions';

const port = (answer: KvHostPort['answer']): KvHostPort => ({ answer, close: () => undefined });

describe('a client kernel kv host ask', () => {
  it('is answered from the registered browser kv store', async () => {
    const seen: [string, JsonValue[]][] = [];
    const stop = registerHostKv(kvHostAction(port(async (op, args) => { seen.push([op, args]); return { ok: { found: true, value: { key: 'k1' } } }; })));
    try {
      expect(await performHostAnswer(webHostActions, 'kv/get', ['answers', 'k1'])).toEqual({ ok: { found: true, value: { key: 'k1' } } });
      expect(seen).toEqual([['kv/get', ['answers', 'k1']]]);
    } finally {
      stop();
    }
  });

  it('reports a store refusal with the kind the completion carries', async () => {
    const stop = registerHostKv(kvHostAction(port(async () => ({ error: { kind: 'denied', message: 'no kv grant covers write on store "x"' } }))));
    try {
      expect(await performHostAnswer(webHostActions, 'kv/put', ['x', 'k', 1])).toEqual({ error: 'no kv grant covers write on store "x"', kind: 'denied' });
    } finally {
      stop();
    }
  });

  it('control: with no store registered the ask is unavailable', async () => {
    const outcome = await performHostAnswer(webHostActions, 'kv/get', ['answers', 'k1']);
    expect('error' in outcome && outcome.kind).toBe('unavailable');
  });
});
