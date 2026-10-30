import { describe, it, expect } from 'vitest';
import type { IoRequestWire } from '@almadar/core/kernel-wire';
import { toPayloadValue, type JsonValue } from '@almadar/core';
import { decodeRequest } from '@almadar/shell-runtime/kernel/decode';

const site = { trait: 'T', followOn: false, emit: { success: 'OK', failure: 'BAD' } };
const ref = { instance: 'i', orbital: 'O', trait: 'T' };

/** One sample per wire kind; keyed by the generated union, so a kind the wire gains cannot go unsampled. */
const SAMPLES: { readonly [K in IoRequestWire['kind']]: Extract<IoRequestWire, { kind: K }> } = {
  readRow: { kind: 'readRow', entityType: 'E', id: '1' },
  listRows: { kind: 'listRows', entityType: 'E' },
  queryRows: { kind: 'queryRows', entityType: 'E', query: {}, project: 'rows' },
  writeRows: { kind: 'writeRows', batch: { ops: [], onFailure: 'atomic' } },
  commitRows: { kind: 'commitRows', rows: [{ entityType: 'E', id: '1', expected: null, write: { kind: 'put', row: { id: '1' } } }] },
  createRow: { kind: 'createRow', entityType: 'E', data: { a: 1 } },
  writeRow: { kind: 'writeRow', entityType: 'E', id: '1', data: { a: 1 } },
  deleteRow: { kind: 'deleteRow', entityType: 'E', id: '1' },
  callService: { kind: 'callService', service: 's', method: 'm', args: {}, key: 'k', site },
  cancelCall: { kind: 'cancelCall', key: 'k' },
  substrate: { kind: 'substrate', op: 'program/eval', args: [] },
  pageFacts: { kind: 'pageFacts', fields: ['hostname', 'screenWidth'] },
  prompt: { kind: 'prompt', text: 't', schema: 's', key: 'k' },
  embed: { kind: 'embed', texts: ['a'], key: 'k' },
  tab: { kind: 'tab', ask: { kind: 'navigate', tab: 7, url: 'https://example.com/a' }, key: 'k' },
  secret: { kind: 'secret', name: 'n', principal: 'p' },
  secretSet: { kind: 'secretSet', name: 'n', value: 'v', ttlMs: 5, principal: 'p' },
  secretRotate: { kind: 'secretRotate', name: 'n', value: 'v', principal: 'p' },
  deliver: { kind: 'deliver', envelope: { id: 'e', from: ref, to: ref, event: 'EV', payload: { a: 1 }, causalId: 'c', hop: 1 }, key: 'k', site },
  random: { kind: 'random', bytes: 4 },
  os: { kind: 'os', op: 'os/recv', args: [1, 2], key: 'k', site },
  credentialStatus: { kind: 'credentialStatus', name: 'n', principal: 'p' },
  credentialForget: { kind: 'credentialForget', name: 'n', principal: 'p' },
  clock: { kind: 'clock' },
  sealed: { kind: 'sealed', op: 'rsa/sign', args: ['SIGNING', 'header.payload'] },
  credentialStoreList: { kind: 'credentialStoreList' },
  credentialStoreRead: { kind: 'credentialStoreRead', name: 'n' },
  credentialStoreWrite: { kind: 'credentialStoreWrite', service: 's', name: 'n', value: 'v' },
  credentialStoreRemove: { kind: 'credentialStoreRemove', name: 'n' },
  credentialStoreRotate: { kind: 'credentialStoreRotate' },
  credentialModeRead: { kind: 'credentialModeRead' },
  credentialModeWrite: { kind: 'credentialModeWrite', mode: 'mock' },
};

function wire(sample: IoRequestWire): JsonValue {
  return toPayloadValue(sample);
}

describe('decodeRequest', () => {
  for (const [kind, sample] of Object.entries(SAMPLES)) {
    it(`round-trips a ${kind} request`, () => {
      expect(decodeRequest(wire(sample))).toEqual(sample);
    });
  }

  it('refuses a kind the wire does not have', () => {
    expect(() => decodeRequest({ kind: 'nope' })).toThrow('IoRequestWire: unknown kind "nope"');
  });
});

describe('decodeRequest follows what the Rust deserializer accepts and produces', () => {
  it('rule 1: an integer field takes an integer in the range of its Rust type', () => {
    expect(decodeRequest({ kind: 'random', bytes: 4 })).toEqual({ kind: 'random', bytes: 4 });
    for (const bytes of [1.5, -1, 4294967296, '4']) {
      expect(() => decodeRequest({ kind: 'random', bytes }), String(bytes)).toThrow(/IoRequestWire\.bytes: expected u32/);
    }
  });

  it('rule 2: a field the type does not declare is dropped, as serde drops it', () => {
    expect(decodeRequest({ kind: 'listRows', entityType: 'E', extra: 1 })).toEqual({ kind: 'listRows', entityType: 'E' });
  });

  it('a missing Option decodes to its absence, and a null Option is absent too', () => {
    expect(decodeRequest({ kind: 'secret', name: 'n' })).toEqual({ kind: 'secret', name: 'n' });
    expect(decodeRequest({ kind: 'secret', name: 'n', principal: null })).toEqual({ kind: 'secret', name: 'n' });
  });
});
