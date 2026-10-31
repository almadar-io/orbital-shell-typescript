/**
 * The Node host's POST to a token endpoint, for the kernel's credential store (`TokenEndpointPost`). It mirrors
 * `credential_transport.rs` of the native host: https only, the origin must be declared in the program's `egress` (the
 * kernel's rule), every address the name resolves to must be public (the kernel's rule), the connection goes to the checked
 * address, a redirect is a failure, and each socket idles out after 5 s. No error text carries a header, a body or a token.
 */
import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { TokenEndpointPost } from '@almadar/shell-runtime';

const IO_TIMEOUT_MS = 5000;

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface NodeTokenPostOptions {
  /** The kernel's egress rule over the program's declared origins. */
  egressAllows(url: string): boolean;
  /** The kernel's public-address rule. */
  isPublicAddress(ip: string): boolean;
  request?: (options: RequestOptions, onResponse: (response: IncomingMessage) => void) => ClientRequest;
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
}

async function systemResolve(host: string): Promise<ResolvedAddress[]> {
  return lookup(host, { all: true });
}

export class TokenPostRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenPostRefusal';
  }
}

function urlOf(endpoint: string): URL {
  try {
    return new URL(endpoint);
  } catch {
    throw new TokenPostRefusal('the token endpoint is not a url');
  }
}

export function createNodeTokenPost(options: NodeTokenPostOptions): TokenEndpointPost {
  const send = options.request ?? httpsRequest;
  const resolve = options.resolve ?? systemResolve;
  return async ({ endpoint, headers, body }) => {
    const url = urlOf(endpoint);
    if (url.protocol !== 'https:') throw new TokenPostRefusal('the token endpoint must be https');
    if (!options.egressAllows(endpoint)) throw new TokenPostRefusal(`${url.host} is not an origin the program declares in egress`);
    const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const addresses: ResolvedAddress[] = isIP(host) !== 0 ? [{ address: host, family: isIP(host) }] : await resolve(host);
    if (addresses.length === 0) throw new TokenPostRefusal(`${host} has no addresses`);
    const private_ = addresses.find((entry) => !options.isPublicAddress(entry.address));
    if (private_ !== undefined) throw new TokenPostRefusal(`${host} resolves to ${private_.address}, not a public address`);
    const checked = addresses[0];
    const payload = Buffer.from(body, 'utf8');
    const requestHeaders: Record<string, string | number> = {};
    for (const [name, value] of headers) requestHeaders[name] = value;
    requestHeaders['Content-Length'] = payload.length;
    requestHeaders['Connection'] = 'close';
    return new Promise((settle, reject) => {
      const req = send(
        {
          method: 'POST',
          protocol: 'https:',
          host,
          port: url.port === '' ? 443 : Number(url.port),
          path: `${url.pathname}${url.search}`,
          headers: requestHeaders,
          timeout: IO_TIMEOUT_MS,
          servername: isIP(host) === 0 ? host : undefined,
          lookup: (_name, lookupOptions, callback) => {
            if (lookupOptions.all === true) callback(null, [{ address: checked.address, family: checked.family }]);
            else callback(null, checked.address, checked.family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            reject(new TokenPostRefusal(`the token endpoint answered a redirect (${status}); redirects are not followed`));
            req.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => settle({ status, body: Buffer.concat(chunks).toString('utf8') }));
          response.on('error', () => reject(new TokenPostRefusal('the token endpoint response failed')));
        },
      );
      req.on('timeout', () => {
        reject(new TokenPostRefusal('the token endpoint timed out'));
        req.destroy();
      });
      req.on('error', (error: NodeJS.ErrnoException) => reject(new TokenPostRefusal(`could not reach the token endpoint${error.code !== undefined ? ` (${error.code})` : ''}`)));
      req.end(payload);
    });
  };
}
