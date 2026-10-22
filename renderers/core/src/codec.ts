import { md5 } from '@noble/hashes/legacy.js';

export type DigestEncoding = 'hex' | 'base64';

export class CodecError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Invalid argument: ${reason}`);
    this.name = 'CodecError';
    this.reason = reason;
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const UNRESERVED = /^[A-Za-z0-9\-_.!~*'()]$/;
const HEX = '0123456789abcdef';

function assertWellFormed(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CodecError('string contains an unpaired surrogate');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new CodecError('string contains an unpaired surrogate');
    }
  }
}

export function utf8Bytes(s: string): Uint8Array {
  assertWellFormed(s);
  return new TextEncoder().encode(s);
}

export function base64EncodeBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 63];
  }
  return out;
}

/** Strict RFC 4648 standard alphabet: padded, canonical trailing bits, no whitespace. */
export function base64DecodeBytes(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new CodecError('base64 length must be a multiple of 4');
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const body = text.length - pad;
  const bytes = new Uint8Array((text.length / 4) * 3 - pad);
  let n = 0;
  for (let i = 0; i < text.length; i += 4) {
    let acc = 0;
    let chars = 0;
    for (let j = 0; j < 4 && i + j < body; j++) {
      const v = BASE64_ALPHABET.indexOf(text[i + j]);
      if (v < 0) throw new CodecError(`base64 contains an invalid character at ${i + j}`);
      acc = (acc << 6) | v;
      chars++;
    }
    acc <<= 6 * (4 - chars);
    const produced = chars === 4 ? 3 : chars - 1;
    if ((acc & ((1 << (24 - 8 * produced)) - 1)) !== 0) {
      throw new CodecError('base64 has non-canonical trailing bits');
    }
    for (let k = 0; k < produced; k++) bytes[n++] = (acc >> (16 - 8 * k)) & 255;
  }
  return bytes;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

export function encodeDigest(bytes: Uint8Array, encoding: DigestEncoding): string {
  return encoding === 'hex' ? hex(bytes) : base64EncodeBytes(bytes);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export function sha256Bytes(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(message.length / 0x20000000), false);
  view.setUint32(padded.length - 4, (message.length << 3) >>> 0, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
  return out;
}

export function md5Bytes(message: Uint8Array): Uint8Array {
  return md5(message);
}

export function hmacSha256Bytes(key: Uint8Array, data: Uint8Array): Uint8Array {
  const block = key.length > 64 ? sha256Bytes(key) : key;
  const ipad = new Uint8Array(64 + data.length);
  const opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    const kb = i < block.length ? block[i] : 0;
    ipad[i] = kb ^ 0x36;
    opad[i] = kb ^ 0x5c;
  }
  ipad.set(data, 64);
  opad.set(sha256Bytes(ipad), 64);
  return sha256Bytes(opad);
}

export function encodeUriComponent(s: string): string {
  let out = '';
  for (const ch of s) {
    if (UNRESERVED.test(ch)) {
      out += ch;
    } else {
      for (const b of utf8Bytes(ch)) out += `%${HEX[b >> 4].toUpperCase()}${HEX[b & 15].toUpperCase()}`;
    }
  }
  return out;
}

export function decodeUriComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new CodecError('URI malformed');
  }
}

export function encodeBase64(text: string): string {
  return base64EncodeBytes(utf8Bytes(text));
}

export function decodeBase64(text: string): string {
  const bytes = base64DecodeBytes(text);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CodecError('base64 does not decode to valid UTF-8');
  }
}

export function hashSha256(text: string, encoding: DigestEncoding): string {
  const message = utf8Bytes(text);
  return encodeDigest(sha256Bytes(message), encoding);
}

export function hmacSha256(key: string, message: string, encoding: DigestEncoding): string {
  const keyBytes = utf8Bytes(key);
  const messageBytes = utf8Bytes(message);
  return encodeDigest(hmacSha256Bytes(keyBytes, messageBytes), encoding);
}

/** MD5 of already-decoded bytes, supplied as standard padded base64. */
export function hashMd5(base64Bytes: string, encoding: DigestEncoding): string {
  return encodeDigest(md5Bytes(base64DecodeBytes(base64Bytes)), encoding);
}
