import { describe, expect, it } from 'vitest';

import { PROTOCOLS, ProtocolSpecSchema } from '../src/protocols.js';

describe('the endpoint protocol table', () => {
  it('names the four protocols in order', () => {
    expect(PROTOCOLS.map((p) => p.name)).toEqual(['route', 'http', 'stdio', 'boot']);
  });

  it('http takes a host, port and optional path address and needs the net-listen grant on the server side', () => {
    const http = PROTOCOLS.find((p) => p.name === 'http');
    expect(http?.address).toEqual([
      { name: 'host', type: 'string', required: true },
      { name: 'port', type: 'number', required: true },
      { name: 'path', type: 'string', required: false },
    ]);
    expect([http?.viewer, http?.grant, http?.side]).toEqual([false, 'net-listen', 'server']);
  });

  it('route is the only viewer and the only client side; stdio needs its grant', () => {
    expect(PROTOCOLS.filter((p) => p.viewer).map((p) => p.name)).toEqual(['route']);
    expect(PROTOCOLS.filter((p) => p.side === 'client').map((p) => p.name)).toEqual(['route']);
    expect(PROTOCOLS.find((p) => p.name === 'stdio')).toMatchObject({ grant: 'stdio', side: 'process', address: null });
    expect(PROTOCOLS.find((p) => p.name === 'boot')).toMatchObject({ grant: null, side: 'start', address: null });
  });

  it('every row reads back through its schema', () => {
    for (const row of PROTOCOLS) expect(ProtocolSpecSchema.parse(row)).toEqual(row);
  });

  it('edge: a row with an unknown side, grant or key is refused', () => {
    const route = PROTOCOLS[0];
    expect(ProtocolSpecSchema.safeParse({ ...route, side: 'moon' }).success).toBe(false);
    expect(ProtocolSpecSchema.safeParse({ ...route, grant: 'net-everything' }).success).toBe(false);
    expect(ProtocolSpecSchema.safeParse({ ...route, sied: 'client' }).success).toBe(false);
  });
});
