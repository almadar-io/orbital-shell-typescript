/**
 * Blobs (EXEC-DIST-16b): a browser-bound server answer carries each SExpr-typed emit payload value as
 * `{ "$blob": n }`, its bytes after the JSON head in a length-framed body (`u32` LE length, then the part). The host
 * keeps the bytes and hands the kernel only the marker, renamed to an id of this table; the kernel releases an id once
 * it lets go of the value (`Kernel.blobsReleased()`), and whoever reads the value (a split guest's view) asks for its bytes.
 *
 * @packageDocumentation
 */

import type { JsonValue } from '@almadar/core';

export const BLOB_MARKER = '$blob';

export const FRAMED_MEDIA_TYPE = 'application/vnd.almadar.framed';

export interface BlobMarker {
  readonly [BLOB_MARKER]: number;
}

export function isBlobMarker(value: JsonValue | undefined | object): value is BlobMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === BLOB_MARKER && typeof Reflect.get(value, BLOB_MARKER) === 'number';
}

/** The head and blobs of a framed body, as views of it. */
export function unframe(body: Uint8Array): { head: Uint8Array; blobs: Uint8Array[] } {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const parts: Uint8Array[] = [];
  let at = 0;
  while (at < body.length) {
    if (at + 4 > body.length) throw new Error('a framed body ends inside a length');
    const length = view.getUint32(at, true);
    const start = at + 4;
    if (start + length > body.length) throw new Error(`a framed part names ${length} bytes and ${body.length - start} remain`);
    parts.push(body.subarray(start, start + length));
    at = start + length;
  }
  const [head, ...blobs] = parts;
  if (head === undefined) throw new Error('a framed body has no head');
  return { head, blobs };
}

export class BlobTable {
  private readonly blobs = new Map<number, Uint8Array>();
  private next = 1;

  /** How many blobs this host holds. */
  get size(): number {
    return this.blobs.size;
  }

  /** A framed answer: its head with each blob renamed to an id of this table, and the ids handed with it. */
  readFramed<T>(body: Uint8Array): { answer: T; handed: number[] } {
    const { head, blobs } = unframe(body);
    const ids = blobs.map((bytes) => {
      const id = this.next++;
      this.blobs.set(id, bytes);
      return id;
    });
    const answer = JSON.parse(new TextDecoder().decode(head), (_key, value: JsonValue) => {
      if (!isBlobMarker(value)) return value;
      const id = ids[value[BLOB_MARKER]];
      if (id === undefined) throw new Error(`kernel wire: the answer names blob ${value[BLOB_MARKER]}, which its body does not carry`);
      return { [BLOB_MARKER]: id };
    });
    return { answer, handed: ids };
  }

  /** The bytes of blob `id`. */
  bytes(id: number): Uint8Array {
    const bytes = this.blobs.get(id);
    if (bytes === undefined) throw new Error(`kernel wire: blob ${id} was never handed to this host, or was released`);
    return bytes;
  }

  /** Drops the ids the kernel let go of (`Kernel.blobsReleased()`, a JSON array of ids). */
  release(idsJson: string): void {
    const ids: number[] = JSON.parse(idsJson);
    for (const id of ids) this.blobs.delete(id);
  }
}

/** The page's one table: the transport hands blobs into it, the kernel client releases them, a guest view reads them. */
export const blobs = new BlobTable();

const handedWith = new WeakMap<object, number[]>();

/** Record the blob ids handed with `answer`, which its fold passes to the kernel. */
export function markHanded(answer: object, ids: number[]): void {
  if (ids.length > 0) handedWith.set(answer, ids);
}

/** The blob ids handed with `answer`, as the JSON array the kernel's fold takes; none for an answer that carried none. */
export function handedJson(answer: object): string | undefined {
  const ids = handedWith.get(answer);
  return ids === undefined ? undefined : JSON.stringify(ids);
}
