// The Node token POST: its rule checks run before any socket, and a fake https module answers the rest.
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { describe, expect, it } from 'vitest';
import { createNodeTokenPost, TokenPostRefusal } from '../src/token-post.js';

const EGRESS = ['https://auth.example.com'];
const PUBLIC = new Set(['93.184.216.34']);

interface Seen {
  options?: RequestOptions;
  written?: string;
}

function fakeHttps(status: number, reply: string, seen: Seen) {
  return (options: RequestOptions, onResponse: (response: IncomingMessage) => void): ClientRequest => {
    seen.options = options;
    const req = Object.assign(new EventEmitter(), {
      end: (payload: Buffer) => {
        seen.written = payload.toString('utf8');
        const response = Object.assign(new EventEmitter(), { statusCode: status, resume: () => undefined });
        onResponse(response as unknown as IncomingMessage);
        response.emit('data', Buffer.from(reply));
        response.emit('end');
      },
      destroy: () => undefined,
    });
    return req as unknown as ClientRequest;
  };
}

function post(origins: string[], seen: Seen, status = 200, reply = '{"ok":true}') {
  return createNodeTokenPost({
    egressAllows: (url) => origins.some((origin) => url.startsWith(`${origin}/`)),
    isPublicAddress: (ip) => PUBLIC.has(ip),
    request: fakeHttps(status, reply, seen),
    resolve: async (host) => (host === 'auth.example.com' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.5', family: 4 }]),
  });
}

const form = { headers: [['Content-Type', 'application/x-www-form-urlencoded'] as [string, string]], body: 'grant_type=refresh_token' };

describe('createNodeTokenPost', () => {
  it('posts the form to the checked public address and answers the status and body', async () => {
    const seen: Seen = {};
    const reply = await post(EGRESS, seen)({ endpoint: 'https://auth.example.com/token?x=1', ...form });
    expect(reply).toEqual({ status: 200, body: '{"ok":true}' });
    expect(seen.written).toBe('grant_type=refresh_token');
    expect(seen.options).toMatchObject({ method: 'POST', host: 'auth.example.com', port: 443, path: '/token?x=1', timeout: 5000 });
    expect(seen.options?.headers).toMatchObject({ 'Content-Length': 24, Connection: 'close' });
  });

  it('refuses http, an undeclared origin, a private address and a redirect, without opening a request for the first three', async () => {
    const seen: Seen = {};
    await expect(post(EGRESS, seen)({ endpoint: 'http://auth.example.com/token', ...form })).rejects.toThrow('must be https');
    await expect(post(EGRESS, seen)({ endpoint: 'https://other.example.com/token', ...form })).rejects.toThrow('egress');
    await expect(post(['https://internal.example.com'], seen)({ endpoint: 'https://internal.example.com/token', ...form })).rejects.toThrow('not a public address');
    await expect(post(['https://10.0.0.1'], seen)({ endpoint: 'https://10.0.0.1/token', ...form })).rejects.toThrow('not a public address');
    expect(seen.options).toBeUndefined();
    const redirect = post(EGRESS, {}, 302, 'moved')({ endpoint: 'https://auth.example.com/token', ...form });
    await expect(redirect).rejects.toBeInstanceOf(TokenPostRefusal);
    await expect(redirect).rejects.toThrow('redirect (302)');
  });

  it('names no body, header or token in a refusal', async () => {
    const error = await post(EGRESS, {}, 301, 'SECRET-BODY')({ endpoint: 'https://auth.example.com/token', headers: [['Authorization', 'Basic SECRET-AUTH']], body: 'refresh_token=SECRET-RT' }).catch((e: Error) => e);
    expect(String(error)).not.toMatch(/SECRET/);
  });
});
