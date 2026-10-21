import { performance } from 'node:perf_hooks';

/** A value the wire carries: what a kernel reply is made of. */
export type WireValue = string | number | boolean | null | WireValue[] | { [key: string]: WireValue };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Minimal MessagePack (nil, bool, float64, str, array, map): the "same serde types through a binary format" variant. */
export function packWire(value: WireValue): Uint8Array {
  const chunks: number[] = [];
  const push = (v: WireValue): void => {
    if (v === null) chunks.push(0xc0);
    else if (typeof v === 'boolean') chunks.push(v ? 0xc3 : 0xc2);
    else if (typeof v === 'number') {
      const b = new DataView(new ArrayBuffer(8));
      b.setFloat64(0, v);
      chunks.push(0xcb);
      for (let i = 0; i < 8; i++) chunks.push(b.getUint8(i));
    } else if (typeof v === 'string') {
      const bytes = encoder.encode(v);
      chunks.push(0xdb, bytes.length >>> 24, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255);
      for (const byte of bytes) chunks.push(byte);
    } else if (Array.isArray(v)) {
      chunks.push(0xdd, v.length >>> 24, (v.length >>> 16) & 255, (v.length >>> 8) & 255, v.length & 255);
      for (const item of v) push(item);
    } else {
      const keys = Object.keys(v);
      chunks.push(0xdf, keys.length >>> 24, (keys.length >>> 16) & 255, (keys.length >>> 8) & 255, keys.length & 255);
      for (const key of keys) {
        push(key);
        push(v[key]);
      }
    }
  };
  push(value);
  return Uint8Array.from(chunks);
}

export function unpackWire(bytes: Uint8Array): WireValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const length = (): number => {
    const n = view.getUint32(at);
    at += 4;
    return n;
  };
  const read = (): WireValue => {
    const tag = bytes[at++];
    switch (tag) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcb: {
        const n = view.getFloat64(at);
        at += 8;
        return n;
      }
      case 0xdb: {
        const n = length();
        const s = decoder.decode(bytes.subarray(at, at + n));
        at += n;
        return s;
      }
      case 0xdd: {
        const n = length();
        const out: WireValue[] = [];
        for (let i = 0; i < n; i++) out.push(read());
        return out;
      }
      case 0xdf: {
        const n = length();
        const out: { [key: string]: WireValue } = {};
        for (let i = 0; i < n; i++) {
          const key = read();
          if (typeof key !== 'string') throw new Error('F3b: a map key is not a string');
          out[key] = read();
        }
        return out;
      }
      default:
        throw new Error(`F3b: unknown tag 0x${tag.toString(16)}`);
    }
  };
  return read();
}

export interface BoundaryPayload {
  name: string;
  value: WireValue;
  /** Bytes of the JSON text, the size the payload has on the wire today. */
  jsonBytes: number;
}

function row(i: number): { [key: string]: WireValue } {
  return { id: `r${i}`, title: `Row number ${i}`, status: i % 3 === 0 ? 'open' : 'closed', amount: i * 1.5, flag: i % 2 === 0, note: null, tags: ['a', 'b', `t${i % 7}`] };
}

function dispatchWire(targetBytes: number): { [key: string]: WireValue } {
  const states: { [key: string]: WireValue } = {};
  const effects: WireValue[] = [];
  let n = 0;
  const wire = (): { [key: string]: WireValue } => ({ response: { success: true, states, effects, data: {} }, mode: 'server', snapshot: null, delivered: [], awaiting: [], statefulLeg: null, foldSeeded: false });
  while (encoder.encode(JSON.stringify(wire())).length < targetBytes) {
    states[`Trait${n}`] = 'idle';
    effects.push(['set', `@entity.field${n}`, `value ${n}`]);
    n++;
  }
  return wire();
}

function payload(name: string, value: WireValue): BoundaryPayload {
  return { name, value, jsonBytes: encoder.encode(JSON.stringify(value)).length };
}

/** The five payloads of design 2.3: three DispatchWire sizes and a 20- and 1000-row page of EntityRows. */
export function boundaryPayloads(): BoundaryPayload[] {
  return [
    payload('wire-0.5KB', dispatchWire(500)),
    payload('wire-5KB', dispatchWire(5_000)),
    payload('wire-50KB', dispatchWire(50_000)),
    payload('rows-20', { rows: Array.from({ length: 20 }, (_, i) => row(i)), totalCount: 20 }),
    payload('rows-1000', { rows: Array.from({ length: 1000 }, (_, i) => row(i)), totalCount: 1000 }),
  ];
}

export type BoundaryVariant = 'json' | 'structured' | 'binary';

/** One encode+decode round trip; the result is returned so nothing is elided. */
export const boundaryVariants: Record<BoundaryVariant, (value: WireValue) => WireValue> = {
  json: (value) => JSON.parse(decoder.decode(encoder.encode(JSON.stringify(value)))),
  structured: (value) => structuredClone(value),
  binary: (value) => unpackWire(packWire(value)),
};

export interface BoundaryRow {
  payload: string;
  jsonBytes: number;
  variant: BoundaryVariant;
  medianMs: number;
  /** Median relative to the JSON variant of the same payload. */
  vsJson: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Times every variant on every payload: `warmup` untimed round trips, then `iterations` timed ones. */
export function runBoundaryMicro(options: { iterations: number; warmup: number }): BoundaryRow[] {
  const rows: BoundaryRow[] = [];
  for (const p of boundaryPayloads()) {
    const medians = {} as Record<BoundaryVariant, number>;
    for (const variant of Object.keys(boundaryVariants) as BoundaryVariant[]) {
      const run = boundaryVariants[variant];
      for (let i = 0; i < options.warmup; i++) run(p.value);
      const samples: number[] = [];
      for (let i = 0; i < options.iterations; i++) {
        const start = performance.now();
        run(p.value);
        samples.push(performance.now() - start);
      }
      medians[variant] = median(samples);
    }
    for (const variant of Object.keys(medians) as BoundaryVariant[]) {
      rows.push({ payload: p.name, jsonBytes: p.jsonBytes, variant, medianMs: medians[variant], vsJson: medians[variant] / medians.json });
    }
  }
  return rows;
}

export function formatBoundaryRows(rows: readonly BoundaryRow[]): string {
  const lines = ['| payload | JSON bytes | variant | median ms | vs json |', '|---|---:|---|---:|---:|'];
  for (const r of rows) lines.push(`| ${r.payload} | ${r.jsonBytes} | ${r.variant} | ${r.medianMs.toFixed(4)} | ${r.vsJson.toFixed(2)}x |`);
  return lines.join('\n');
}
