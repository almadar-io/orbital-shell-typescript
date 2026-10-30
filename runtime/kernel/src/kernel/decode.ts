/** Decoders for what the kernel hands back as JSON: the generated decoders of `@almadar/core/kernel-wire`, which throw naming the failing path. */
import {
  decodeFiredTick,
  decodeIoRequestWire,
  decodeNextWire,
  decodeResolveProgressWire,
  decodeServerProgressWire,
} from '@almadar/core/kernel-wire';
import type { JsonValue } from '@almadar/core';
import type { FiredTick } from '@almadar/core/kernel-wire';
import type { NextWire, ResolveProgressWire, ServerProgressWire } from './wire.js';

export { decodeIoRequestWire as decodeRequest };

export function decodeProgress(json: string): ServerProgressWire {
  return decodeServerProgressWire(JSON.parse(json));
}

export function decodeNext(json: string): NextWire | null {
  const value: JsonValue = JSON.parse(json);
  return value === null ? null : decodeNextWire(value);
}

export function decodeResolveProgress(json: string): ResolveProgressWire {
  return decodeResolveProgressWire(JSON.parse(json));
}

export function decodeDueTicks(json: string): FiredTick[] {
  const value: JsonValue = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error('tickPass: the kernel answered a non-list');
  return value.map(decodeFiredTick);
}
