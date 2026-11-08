import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@almadar/core';
import type { CallSiteWire, OsError } from '@almadar/core/kernel-wire';
import { createNativeOsPort } from '../src/kernel/os-port.js';
import type { NativeOsHost, NativeOsHostClass, NativeOsServer } from '../src/kernel/wire.js';

type Report = (key: string, kind: string, json: string) => void;

const site: CallSiteWire = { trait: 'Host', followOn: false, emit: { success: 'DONE', failure: 'BAD', onMessage: 'MSG' } };
const server: NativeOsServer = { setOsAnchors: () => '[]' };

function fakeAddon(answer: string): { port: ReturnType<typeof createNativeOsPort>; report: Report } {
  let report: Report | undefined;
  const host: NativeOsHost = { answer: () => answer, answerKeyed: () => answer, cancel: () => true, close: () => undefined };
  const addon: NativeOsHostClass = class {
    constructor(_anchors: string, onCompletion: Report) {
      report = onCompletion;
      return host;
    }
  };
  const port = createNativeOsPort(addon, {}, () => server);
  return { port, report: (key, kind, json) => report?.(key, kind, json) };
}

function openStream(answer: string) {
  const { port, report } = fakeAddon(answer);
  const seen: string[] = [];
  const stream = port.stream;
  if (stream === undefined) throw new Error('the native port streams');
  const open = stream('os/stdin-read', [], 'k', site,
    (value: JsonValue) => { seen.push(`message ${JSON.stringify(value)}`); return true; },
    (error: OsError) => { seen.push(`fail ${error.kind}`); },
    (final) => { seen.push(`ended ${JSON.stringify(final)}`); });
  return { open, report, seen };
}

describe('the native os port closes a stream', () => {
  it('reports a stream that ends with no event as ended(null), once', async () => {
    const { open, report, seen } = openStream('{"ok":{"sock":3}}');
    await open;
    report('k', 'message', '{"ok":{"n":1}}');
    report('k', 'ended', 'null');
    report('k', 'ended', 'null');
    expect(seen).toEqual(['message {"n":1}', 'ended null']);
  });

  it('reports a stream that closes on a success as ended with that outcome', async () => {
    const { open, report, seen } = openStream('{"deferred":true}');
    expect(await open).toEqual({ ok: null });
    report('k', 'complete', '{"ok":{"eof":true}}');
    expect(seen).toEqual(['ended {"ok":{"eof":true}}']);
  });

  it('control: a stream that fails after the answer reaches fail, not ended', async () => {
    const { open, report, seen } = openStream('{"ok":{"sock":3}}');
    await open;
    report('k', 'complete', '{"error":{"kind":"io","message":"gone"}}');
    expect(seen).toEqual(['fail io']);
  });
});
