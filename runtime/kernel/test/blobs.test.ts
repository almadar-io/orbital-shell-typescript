import { describe, expect, it } from 'vitest';
import { BlobTable, unframe } from '../src/kernel/blobs.js';

const utf8 = new TextEncoder();

function framed(head: string, blobs: string[]): Uint8Array {
  const parts = [head, ...blobs].map((part) => utf8.encode(part));
  const body = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
  const view = new DataView(body.buffer);
  let at = 0;
  for (const part of parts) {
    view.setUint32(at, part.length, true);
    body.set(part, at + 4);
    at += 4 + part.length;
  }
  return body;
}

const answer = (program: object) => JSON.stringify({ success: true, emittedEvents: [{ event: 'GUEST_CLIENT', payload: { guest: 'g', program } }] });
type Answer = { emittedEvents: Array<{ payload: { program: { $blob: number } } }> };

describe('framed answers (EXEC-DIST-16b)', () => {
  it('splits a framed body into its head and blobs', () => {
    const { head, blobs } = unframe(framed('{}', ['{"name":"g"}', '', 'نص']));
    expect(new TextDecoder().decode(head)).toBe('{}');
    expect(blobs.map((b) => new TextDecoder().decode(b))).toEqual(['{"name":"g"}', '', 'نص']);
  });

  it('refuses a body cut inside a part', () => {
    const body = framed('{}', ['abc']);
    expect(() => unframe(body.subarray(0, body.length - 1))).toThrow();
    expect(() => unframe(body.subarray(0, 2))).toThrow();
    expect(() => unframe(new Uint8Array())).toThrow();
  });

  it('keeps each blob under an id of its own and names it by that id in the answer', () => {
    const table = new BlobTable();
    const first = table.readFramed<Answer>(framed(answer({ $blob: 0 }), ['{"name":"crm"}']));
    const second = table.readFramed<Answer>(framed(answer({ $blob: 0 }), ['{"name":"hr"}']));
    const firstId = first.answer.emittedEvents[0].payload.program.$blob;
    const secondId = second.answer.emittedEvents[0].payload.program.$blob;
    expect(first.handed).toEqual([firstId]);
    expect(secondId).not.toBe(firstId);
    expect(new TextDecoder().decode(table.bytes(firstId))).toBe('{"name":"crm"}');
    expect(new TextDecoder().decode(table.bytes(secondId))).toBe('{"name":"hr"}');
    expect(table.size).toBe(2);
  });

  it('drops the blobs the kernel released, and refuses an id it no longer holds', () => {
    const table = new BlobTable();
    const { handed } = table.readFramed<Answer>(framed(answer({ $blob: 0 }), ['{}']));
    table.release(JSON.stringify(handed));
    expect(table.size).toBe(0);
    expect(() => table.bytes(handed[0])).toThrow(/never handed|released/);
  });

  it('control: an answer naming no blob hands none', () => {
    const table = new BlobTable();
    const { answer: read, handed } = table.readFramed<{ success: boolean }>(framed('{"success":true}', []));
    expect(read.success).toBe(true);
    expect(handed).toEqual([]);
  });

  it('refuses a marker naming a blob the body does not carry', () => {
    expect(() => new BlobTable().readFramed(framed(answer({ $blob: 1 }), ['{}']))).toThrow(/blob 1/);
  });
});
