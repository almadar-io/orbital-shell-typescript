import { describe, expect, it, vi } from 'vitest';
import { BlobTable, readDefsJson, unframe, writeDefsJson } from '../src/kernel/blobs.js';
import { FetchSchemaLoader } from '../src/loader/fetch-loader.js';

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

describe('a blob written with $def (G-CROSS-637)', () => {
  type Styled = { a: { fill: string }; b: Array<{ fill: string }> };
  const handed = (text: string) => {
    const table = new BlobTable();
    const { handed: [id] } = table.readFramed(framed(answer({ $blob: 0 }), [text]));
    if (id === undefined) throw new Error('no blob handed');
    return { table, id };
  };

  it('reads each part held twice as one shared object, equal to the plain text', () => {
    const { table, id } = handed('{"a":{"$def":0,"value":{"fill":"#0d0f1e"}},"b":[{"$def":0},{"$def":0}]}');
    const read = table.json<Styled>(id);
    expect(read).toEqual({ a: { fill: '#0d0f1e' }, b: [{ fill: '#0d0f1e' }, { fill: '#0d0f1e' }] });
    expect(read.b[0]).toBe(read.a);
    expect(read.b[1]).toBe(read.a);
  });

  it('reads a reference that comes before its definition in key order', () => {
    const { table, id } = handed('{"7":{"$def":0},"z":{"$def":0,"value":[1,{"$def":1,"value":{"x":1}},{"$def":1}]}}');
    expect(table.json(id)).toEqual({ 7: [1, { x: 1 }, { x: 1 }], z: [1, { x: 1 }, { x: 1 }] });
  });

  it('control: a blob with no $def reads as its plain text', () => {
    const text = '{"name":"guest","orbitals":[{"name":"نص","traits":[]}]}';
    const { table, id } = handed(text);
    expect(table.json(id)).toEqual(JSON.parse(text));
  });

  it('refuses a reference to a part the blob never defines', () => {
    const { table, id } = handed('{"a":{"$def":3}}');
    expect(() => table.json(id)).toThrow(/\$def 3/);
  });
});

describe('a program document written with $def (orb resolve, program.client.orb)', () => {
  type Program = { name: string; orbitals: Array<{ traits: Array<{ stateMachine: { transitions: Array<{ event: string }> } }> }> };
  const transition = { effects: [['set', '@entity.v', 1]], event: 'X', from: 'idle', to: 'idle' };
  const plain = { name: 'app', orbitals: [{ traits: [{ stateMachine: { transitions: [transition, transition] } }] }] };
  const written = '{"name":"app","orbitals":[{"traits":[{"stateMachine":{"transitions":[{"$def":0,"value":{"effects":[["set","@entity.v",1]],"event":"X","from":"idle","to":"idle"}},{"$def":0}]}}]}]}';

  it('reads a repeated record as one shared object, equal to the plain program', () => {
    const read = readDefsJson<Program>(written);
    expect(read).toEqual(plain);
    const [first, second] = read.orbitals[0]?.traits[0]?.stateMachine.transitions ?? [];
    expect(second).toBe(first);
  });

  it('control: a program with no $def reads as its plain text', () => {
    expect(readDefsJson(JSON.stringify(plain))).toEqual(plain);
  });

  it('control: the marker spelled in a value is text', () => {
    expect(readDefsJson('{"name":"$def","note":"{\\"$def\\":1}"}')).toEqual({ name: '$def', note: '{"$def":1}' });
  });

  it('the lazy loader reads a page program written with $def', async () => {
    const fetched = vi.fn(async () => new Response(written, { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    try {
      const loader = new FetchSchemaLoader('https://app.test/program.client.orb');
      const loaded = await loader.load('./page.orb');
      expect(loaded.success && loaded.data.schema).toEqual(plain);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('writing a value with $def (the program a browser hands its kernel)', () => {
  it('writes an object held twice once, and reads back as the value', () => {
    const shared = { effects: [['set', '@entity.v', 1]], event: 'X' };
    const value = { orbitals: [{ transitions: [shared, shared] }, { transitions: [shared] }] };
    const text = writeDefsJson(value);
    expect(text.match(/"event"/g)?.length).toBe(1);
    expect(readDefsJson(text)).toEqual(value);
  });

  it('control: a value holding nothing twice is its plain JSON', () => {
    const value = { name: 'نص', n: [1, 2.5, -0, null, true], nested: { a: [], b: {} } };
    expect(writeDefsJson(value)).toBe(JSON.stringify(value));
  });

  it('control: equal but separate objects are written in full each time', () => {
    const value = [{ a: 1 }, { a: 1 }];
    expect(writeDefsJson(value)).toBe(JSON.stringify(value));
  });

  it('edge: what JSON.stringify drops or nulls is dropped or nulled the same way', () => {
    const shared = { keep: 1, gone: undefined };
    const value = { list: [undefined, shared, shared], f: undefined };
    expect(readDefsJson(writeDefsJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('edge: a shared empty list or record is written plain', () => {
    const empty: unknown[] = [];
    expect(writeDefsJson({ a: empty, b: empty })).toBe('{"a":[],"b":[]}');
  });
});
