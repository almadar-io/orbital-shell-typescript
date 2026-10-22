import { describe, expect, it, vi } from 'vitest';
import {
  base64EncodeBytes,
  base64DecodeBytes,
  sha256Bytes,
  hmacSha256Bytes,
  md5Bytes,
  hashMd5,
  encodeUriComponent,
  decodeUriComponent,
  encodeBase64,
  decodeBase64,
  hashSha256,
  hmacSha256,
  utf8Bytes,
  encodeDigest,
  CodecError,
  type DigestEncoding,
} from '../index.js';

describe('canonical synchronous codec owner', () => {
  it('exports every browser-safe pure function and the typed codec error from core', () => {
    for (const helper of [base64EncodeBytes, base64DecodeBytes, sha256Bytes, hmacSha256Bytes, md5Bytes, hashMd5, encodeUriComponent, encodeBase64, decodeBase64, hashSha256, hmacSha256, utf8Bytes, encodeDigest, CodecError]) {
      expect(typeof helper).toBe('function');
    }
    const encodings: DigestEncoding[] = ['hex', 'base64'];
    expect(encodings).toEqual(['hex', 'base64']);
  });

  it('preserves standard padded base64 for empty, partial and full byte groups', () => {
    for (const [text, encoded] of [['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'], ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy']]) {
      expect(encodeBase64(text)).toBe(encoded);
      expect(decodeBase64(encoded)).toBe(text);
    }
    const bytes = new Uint8Array([0, 255, 128, 1]);
    expect(base64EncodeBytes(bytes)).toBe('AP+AAQ==');
    expect(base64DecodeBytes('AP+AAQ==')).toEqual(bytes);
  });

  it('keeps byte decoding independent from UTF-8 text decoding', () => {
    expect(base64DecodeBytes('/w==')).toEqual(new Uint8Array([255]));
    expect(() => decodeBase64('/w==')).toThrow(CodecError);
    expect(() => decodeBase64('/w==')).toThrow('base64 does not decode to valid UTF-8');
    expect(() => decodeBase64('wK8=')).toThrow('base64 does not decode to valid UTF-8');
    expect(() => decodeBase64('7aCA')).toThrow('base64 does not decode to valid UTF-8');
  });

  it('preserves base64 syntax error messages without relaxing padding, alphabet or trailing bits', () => {
    for (const [text, message] of [
      ['Zg=', 'base64 length must be a multiple of 4'],
      ['Zg-=', 'base64 contains an invalid character at 2'],
      [' Zg=', 'base64 contains an invalid character at 0'],
      ['Zh==', 'base64 has non-canonical trailing bits'],
    ]) {
      expect(() => base64DecodeBytes(text)).toThrow(CodecError);
      expect(() => base64DecodeBytes(text)).toThrow(message);
    }
    expect(base64DecodeBytes('Zg==')).toEqual(new Uint8Array([102]));
  });

  it('preserves Unicode, NUL and paired UTF-16 surrogates', () => {
    expect(utf8Bytes('\0é😀')).toEqual(new Uint8Array([0, 195, 169, 240, 159, 152, 128]));
    expect(encodeBase64('\0é😀')).toBe('AMOp8J+YgA==');
    expect(decodeBase64('AMOp8J+YgA==')).toBe('\0é😀');
  });

  it('decodes URI components exactly like decodeURIComponent and rejects malformed input as a CodecError', () => {
    expect(decodeUriComponent('a+b%2Bc%20%E2%82%AC%F0%9F%98%80')).toBe('a+b+c €😀');
    expect(decodeUriComponent(encodeUriComponent(' /?:&=+#€😀'))).toBe(' /?:&=+#€😀');
    for (const bad of ['%', '%G0', '%C3', '%C0%80', '%ED%A0%80']) {
      expect(() => decodeUriComponent(bad), bad).toThrow(CodecError);
      expect(() => decodeUriComponent(bad), bad).toThrow('URI malformed');
    }
  });

  it('preserves the existing URI-component unreserved marks and uppercase UTF-8 escapes', () => {
    expect(encodeUriComponent("AZaz09-_.!~*'()")).toBe("AZaz09-_.!~*'()");
    expect(encodeUriComponent(' /?:&=+#€😀')).toBe('%20%2F%3F%3A%26%3D%2B%23%E2%82%AC%F0%9F%98%80');
  });

  it('rejects unpaired surrogates through the one UTF-8 owner with the unchanged error', () => {
    for (const text of ['\ud800', 'a\udc00', '\ud800x']) {
      for (const run of [() => utf8Bytes(text), () => encodeUriComponent(text), () => encodeBase64(text), () => hashSha256(text, 'hex'), () => hmacSha256(text, 'message', 'hex'), () => hmacSha256('key', text, 'hex')]) {
        expect(run).toThrow(CodecError);
        expect(run).toThrow('string contains an unpaired surrogate');
      }
    }
  });

  it('md5Bytes is synchronous, byte-oriented and matches RFC 1321 and arbitrary bytes', () => {
    const digest = md5Bytes(new Uint8Array([97, 98, 99]));
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(encodeDigest(digest, 'hex')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(encodeDigest(md5Bytes(new Uint8Array(0)), 'hex')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(encodeDigest(md5Bytes(new Uint8Array([0, 255, 128, 127])), 'hex')).toBe('35913419231430075897c28e5e159b65');
    expect(hashMd5('YWJj', 'hex')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hashMd5('YWJj', 'base64')).toBe('kAFQmDzST7DWlj99KOF/cg==');
    expect(() => hashMd5('YWJ', 'hex')).toThrow(CodecError);
  });

  it('preserves SHA-256 known vectors and both digest encodings', () => {
    expect(hashSha256('', 'hex')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hashSha256('abc', 'hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashSha256('abc', 'base64')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    expect(encodeDigest(sha256Bytes(new Uint8Array([97, 98, 99])), 'hex')).toBe(hashSha256('abc', 'hex'));
    expect(encodeDigest(new Uint8Array([0, 255]), 'hex')).toBe('00ff');
    expect(encodeDigest(new Uint8Array([0, 255]), 'base64')).toBe('AP8=');
  });

  it('preserves HMAC-SHA-256 short-key and long-key normalization vectors', () => {
    const shortKey = new Uint8Array(20).fill(0x0b);
    expect(encodeDigest(hmacSha256Bytes(shortKey, utf8Bytes('Hi There')), 'hex')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    const longKey = new Uint8Array(131).fill(0xaa);
    expect(encodeDigest(hmacSha256Bytes(longKey, utf8Bytes('Test Using Larger Than Block-Size Key - Hash Key First')), 'hex')).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
    expect(hmacSha256('key', 'The quick brown fox jumps over the lazy dog', 'hex')).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    expect(hmacSha256('key', 'message', 'base64')).toBe(base64EncodeBytes(hmacSha256Bytes(utf8Bytes('key'), utf8Bytes('message'))));
  });

  it('preserves the public legacy error message and separately exposes its raw reason', () => {
    try {
      base64DecodeBytes('Zg=');
      throw new Error('invalid base64 accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(CodecError);
      if (!(error instanceof CodecError)) throw error;
      expect(error.name).toBe('CodecError');
      expect(error.message).toBe('Invalid argument: base64 length must be a multiple of 4');
      expect(error.reason).toBe('base64 length must be a multiple of 4');
    }
  });

  it('propagates unexpected encoder and digest faults unchanged', () => {
    const failure = new Error('unexpected codec dependency defect');
    const encoder = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => { throw failure; });
    try {
      expect(() => encodeBase64('text')).toThrow(failure);
      expect(() => encodeUriComponent(' ')).toThrow(failure);
    } finally {
      encoder.mockRestore();
    }
    const digest = vi.spyOn(DataView.prototype, 'setUint32').mockImplementation(() => { throw failure; });
    try {
      expect(() => hashSha256('text', 'hex')).toThrow(failure);
      expect(() => hmacSha256('key', 'text', 'hex')).toThrow(failure);
    } finally {
      digest.mockRestore();
    }
  });

  it('preserves the legacy broad UTF-8 decoder error mapping', () => {
    const decoder = vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(() => { throw new Error('unexpected decoder defect'); });
    try {
      expect(() => decodeBase64('Zg==')).toThrow(CodecError);
      expect(() => decodeBase64('Zg==')).toThrow('base64 does not decode to valid UTF-8');
    } finally {
      decoder.mockRestore();
    }
  });
});
