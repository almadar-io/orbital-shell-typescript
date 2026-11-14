/**
 * Held render values (EXEC-DIST-16): a browser kernel writes a render value it already handed this host as
 * `{ "$held": n }`, and the first time as `{ "$held": n, "value": … }`. One `HeldValues` per kernel keeps each
 * value by id, so every answer that names it reads the same frozen object, until the kernel releases the id.
 *
 * @packageDocumentation
 */

import type { JsonValue } from '@almadar/core';

type JsonObject = { [key: string]: JsonValue };

export const HELD_MARKER = '$held';

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function freezeDeep(value: JsonValue): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const child of Array.isArray(value) ? value : Object.values(value)) freezeDeep(child);
  Object.freeze(value);
}

export class HeldValues {
  private readonly values = new Map<number, JsonValue>();

  /** How many values this host holds for its kernel. */
  get size(): number {
    return this.values.size;
  }

  /** One kernel answer: its JSON with every held leaf replaced by the value it names. */
  read<T>(text: string): T {
    const parsed = JSON.parse(text);
    if (text.includes(`"${HELD_MARKER}"`)) this.resolveWithin(parsed);
    return parsed;
  }

  /** Drops the ids the kernel let go of (`Kernel.heldReleased()`, a JSON array of ids). */
  release(idsJson: string): void {
    const ids: number[] = JSON.parse(idsJson);
    for (const id of ids) this.values.delete(id);
  }

  private resolveWithin(node: JsonValue): void {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = this.resolved(node[i]);
    } else if (isObject(node)) {
      for (const key of Object.keys(node)) node[key] = this.resolved(node[key]);
    }
  }

  private resolved(node: JsonValue): JsonValue {
    if (!isObject(node)) {
      this.resolveWithin(node);
      return node;
    }
    const id = node[HELD_MARKER];
    if (typeof id !== 'number') {
      this.resolveWithin(node);
      return node;
    }
    const sent = node.value;
    if (sent !== undefined) {
      this.resolveWithin(sent);
      freezeDeep(sent);
      this.values.set(id, sent);
      return sent;
    }
    const kept = this.values.get(id);
    if (kept === undefined) throw new Error(`kernel wire: held value ${id} was never handed to this host, or was released`);
    return kept;
  }
}
