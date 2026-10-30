/**
 * The `kv` family on Node: `kv/get`, `kv/put`, `kv/delete`, `kv/scan`, `kv/batch` over a directory or a memory map.
 * Every result is data: a miss is `{ found: false }`, a delete of a miss is `{ existed: false }`; only a bad request or a
 * storage failure is a `{ ok: false, error, kind }`. The grant decisions are the kernel's; nothing here decides a grant.
 *
 * ON-DISK LAYOUT (shared with the native Rust host; a state directory is portable between the two):
 *   <stateDir>/kv/<app>/<locale>/<store>.json      one file per namespace `kv:<app>:<locale>:<store>`
 * - `app`, `locale` and `store` are single path segments of `[A-Za-z0-9._-]+`, never `.` or `..`; anything else is `invalid`.
 * - The file is ONE JSON object `{ "<key>": <JsonValue>, ... }`, UTF-8, keys sorted by UTF-8 byte order, no whitespace.
 *   A key is a JSON string (JSON escaping), so any key is storable and no separate escaping exists; a prefix scan is a
 *   byte-prefix test on the decoded key, so `order/` never matches `order-line/`. An absent file is an empty store.
 * - Every write rewrites the file: serialize, write `<store>.json.tmp-<random>` in the same directory, fsync, `rename`
 *   over `<store>.json`. A rename is atomic, so a crash or failure leaves the previous file whole.
 * - `kv/batch` is therefore ONE file commit (one file per store, by design: renames across several files cannot be
 *   atomic). All ops of a batch apply to one in-memory copy and one rename commits them, or none.
 * - A writer in another process is not locked out; within this process writes to a namespace are serialized.
 */
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { JsonValue } from '@almadar/core';

export type KvErrorKind = 'denied' | 'invalid' | 'io' | 'timeout' | 'unsupported' | 'closed';

export type KvResult<T> = { ok: true; value: T } | { ok: false; error: string; kind: KvErrorKind };

export interface KvNamespace {
  app: string;
  locale: string;
  store: string;
}

interface KvScanEntry {
  key: string;
  value: JsonValue;
}

export type KvBatchOp = { kind: 'put'; key: string; value: JsonValue } | { kind: 'delete'; key: string };

export class KvFailure extends Error {
  constructor(readonly kind: KvErrorKind, message: string) {
    super(message);
  }
}

/** A namespace's whole content, key order = UTF-8 byte order. Backends load and commit it whole. */
type KvTable = Map<string, JsonValue>;

export interface KvBackend {
  load(ns: KvNamespace): Promise<KvTable>;
  /** Replace the namespace content atomically: a failure leaves the previous content. */
  commit(ns: KvNamespace, table: KvTable): Promise<void>;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;

function namespaceId(ns: KvNamespace): string {
  return `kv:${ns.app}:${ns.locale}:${ns.store}`;
}

function checkNamespace(ns: KvNamespace): void {
  for (const [what, seg] of [['app', ns.app], ['locale', ns.locale], ['store', ns.store]] as const) {
    if (!SEGMENT.test(seg) || seg === '.' || seg === '..') throw new KvFailure('invalid', `kv ${what} name ${JSON.stringify(seg)} is not [A-Za-z0-9._-]+`);
  }
}

function checkString(what: string, s: unknown): string {
  if (typeof s !== 'string') throw new KvFailure('invalid', `kv ${what} must be a string`);
  if (LONE_SURROGATE.test(s)) throw new KvFailure('invalid', `kv ${what} is not valid UTF-8`);
  return s;
}

function checkJson(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new KvFailure('invalid', `kv value at ${path} is not a finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => checkJson(item, `${path}[${i}]`));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) Object.defineProperty(out, k, { value: checkJson(v, `${path}.${k}`), enumerable: true, writable: true, configurable: true });
    return out;
  }
  throw new KvFailure('invalid', `kv value at ${path} is not JSON`);
}

function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function serialize(table: KvTable): string {
  const keys = [...table.keys()].sort(byteCompare);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(table.get(k))}`).join(',')}}`;
}

function parseTable(text: string): KvTable {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new KvFailure('io', 'kv store file is not a JSON object');
  const table: KvTable = new Map();
  for (const [k, v] of Object.entries(parsed)) table.set(k, checkJson(v, k));
  return table;
}

export function memoryKvBackend(): KvBackend {
  const tables = new Map<string, KvTable>();
  return {
    async load(ns) {
      return new Map(tables.get(namespaceId(ns)) ?? []);
    },
    async commit(ns, table) {
      tables.set(namespaceId(ns), new Map(table));
    },
  };
}

function isErrno(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

export function directoryKvBackend(stateDir: string): KvBackend {
  const fileOf = (ns: KvNamespace): { dir: string; file: string } => {
    const dir = join(stateDir, 'kv', ns.app, ns.locale);
    return { dir, file: join(dir, `${ns.store}.json`) };
  };
  return {
    async load(ns) {
      const { file } = fileOf(ns);
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (e) {
        if (isErrno(e, 'ENOENT')) return new Map();
        throw new KvFailure('io', `kv read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        return parseTable(text);
      } catch (e) {
        if (e instanceof KvFailure) throw e;
        throw new KvFailure('io', `kv store file is corrupt: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async commit(ns, table) {
      const { dir, file } = fileOf(ns);
      const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`;
      try {
        await mkdir(dir, { recursive: true });
        const handle = await open(tmp, 'w');
        try {
          await handle.writeFile(serialize(table), 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(tmp, file);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw new KvFailure('io', `kv write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

export interface KvHost {
  get(ns: KvNamespace, key: string): Promise<KvResult<{ found: boolean; value?: JsonValue }>>;
  put(ns: KvNamespace, key: string, value: JsonValue): Promise<KvResult<{ storedKey: string }>>;
  delete(ns: KvNamespace, key: string): Promise<KvResult<{ existed: boolean }>>;
  scan(ns: KvNamespace, prefix: string, limit?: number): Promise<KvResult<{ entries: KvScanEntry[] }>>;
  batch(ns: KvNamespace, ops: readonly KvBatchOp[]): Promise<KvResult<{ applied: number }>>;
}

export function createKvHost(backend: KvBackend): KvHost {
  const tails = new Map<string, Promise<unknown>>();
  const serialized = <T>(ns: KvNamespace, run: () => Promise<T>): Promise<T> => {
    const id = namespaceId(ns);
    const next = (tails.get(id) ?? Promise.resolve()).then(run, run);
    tails.set(id, next.catch(() => undefined));
    return next;
  };
  const guard = async <T>(run: () => Promise<T>): Promise<KvResult<T>> => {
    try {
      return { ok: true, value: await run() };
    } catch (e) {
      if (e instanceof KvFailure) return { ok: false, error: e.message, kind: e.kind };
      return { ok: false, error: e instanceof Error ? e.message : String(e), kind: 'io' };
    }
  };
  return {
    get: (ns, key) => guard(async () => {
      checkNamespace(ns);
      checkString('key', key);
      const table = await backend.load(ns);
      const value = table.get(key);
      return value === undefined ? { found: false } : { found: true, value };
    }),
    put: (ns, key, value) => guard(() => {
      checkNamespace(ns);
      checkString('key', key);
      const checked = checkJson(value, 'value');
      return serialized(ns, async () => {
        const table = await backend.load(ns);
        table.set(key, checked);
        await backend.commit(ns, table);
        return { storedKey: key };
      });
    }),
    delete: (ns, key) => guard(() => {
      checkNamespace(ns);
      checkString('key', key);
      return serialized(ns, async () => {
        const table = await backend.load(ns);
        const existed = table.delete(key);
        if (existed) await backend.commit(ns, table);
        return { existed };
      });
    }),
    scan: (ns, prefix, limit) => guard(async () => {
      checkNamespace(ns);
      checkString('prefix', prefix);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) throw new KvFailure('invalid', 'kv scan limit must be a non-negative integer');
      const table = await backend.load(ns);
      const wanted = Buffer.from(prefix, 'utf8');
      const hits = [...table.keys()]
        .filter((k) => Buffer.from(k, 'utf8').subarray(0, wanted.length).equals(wanted))
        .sort(byteCompare);
      const entries: KvScanEntry[] = [];
      for (const key of limit === undefined ? hits : hits.slice(0, limit)) {
        const value = table.get(key);
        if (value !== undefined) entries.push({ key, value });
      }
      return { entries };
    }),
    batch: (ns, ops) => guard(() => {
      checkNamespace(ns);
      const checked: KvBatchOp[] = ops.map((op, i) => {
        const key = checkString(`batch op ${i} key`, op.key);
        if (op.kind === 'put') return { kind: 'put', key, value: checkJson(op.value, `ops[${i}].value`) };
        if (op.kind === 'delete') return { kind: 'delete', key };
        throw new KvFailure('invalid', `kv batch op ${i} has unknown kind`);
      });
      return serialized(ns, async () => {
        const table = await backend.load(ns);
        for (const op of checked) {
          if (op.kind === 'put') table.set(op.key, op.value);
          else table.delete(op.key);
        }
        await backend.commit(ns, table);
        return { applied: checked.length };
      });
    }),
  };
}
