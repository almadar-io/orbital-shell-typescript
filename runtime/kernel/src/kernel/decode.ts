/** Decoders for what the kernel hands back as JSON: the generated decoders of `@almadar/core/kernel-wire`, which throw naming the failing path. */
import {
  decodeFiredTick,
  decodeIoRequestWire,
  decodeNextWire,
  decodeResolveProgressWire,
  decodeServerProgressWire,
} from '@almadar/core/kernel-wire';
import type { JsonValue } from '@almadar/core';
import type { FiredByOrbital, NextWire, ResolveProgressWire, ServerProgressWire } from './wire.js';

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

export function decodeDueTicks(json: string): FiredByOrbital {
  const value: JsonValue = JSON.parse(json);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('tickPass: the kernel answered a non-object');
  const byOrbital: FiredByOrbital = {};
  for (const [orbital, ticks] of Object.entries(value)) {
    if (!Array.isArray(ticks)) throw new Error(`tickPass: the kernel answered a non-list for orbital ${orbital}`);
    byOrbital[orbital] = ticks.map(decodeFiredTick);
  }
  return byOrbital;
}
