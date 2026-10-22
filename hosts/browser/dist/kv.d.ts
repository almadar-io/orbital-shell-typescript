import { JsonValue } from '@almadar/core';
import { Settled, OsError } from '@almadar/core/kernel-wire';

/**
 * The `kv` port of a browser kernel host: `kv/get|put|delete|scan|batch` over IndexedDB, with no Node builtin in sight.
 * The grant check is the Rust `OsGrants` kv requirement, passed in as `allows`; this file only maps a verified request.
 * One IndexedDB database per app and locale (`kv:<app>:<locale>`), one object store per kv store, out-of-line string keys.
 */

type KvOp = 'kv/get' | 'kv/put' | 'kv/delete' | 'kv/scan' | 'kv/batch';
type KvMode = 'read' | 'write';
/** One thing a `kv/` call needs from the program's grants: the JSON of the Rust `kv` requirement. */
interface KvRequirement {
    need: 'kv';
    store: string;
    mode: KvMode;
}
type KvBatchOp = {
    kind: 'put';
    key: string;
    value: JsonValue;
} | {
    kind: 'delete';
    key: string;
};
interface KvHostPort {
    answer(op: KvOp, args: JsonValue[]): Promise<Settled<JsonValue, OsError>>;
    defer?(op: KvOp, args: JsonValue[], key: string, deliver: (outcome: Settled<JsonValue, OsError>) => void): Settled<null, OsError>;
    cancel?(key: string): boolean;
    close(): void;
}
interface KvWebOptions {
    app: string;
    locale: string;
    /** Defaults to `globalThis.indexedDB`; a host without one answers every ask `unsupported`. */
    factory?: IDBFactory;
    /** The wasm grant decision (`OsGrants` kv requirement). Absent means every request is allowed. */
    allows?: (need: KvRequirement) => boolean;
    /** Fails an ask with `timeout` when storage has not answered in this many milliseconds. */
    timeoutMs?: number;
}
/** The namespace a kv store lives under: `kv:<app>:<locale>:<store>`. */
declare function kvNamespace(app: string, locale: string, store: string): string;
/** The IndexedDB database that holds every kv store of one app and locale. */
declare function kvDatabaseName(app: string, locale: string): string;
declare class KvWebPort implements KvHostPort {
    private readonly options;
    private db;
    private lane;
    private closed;
    private readonly pending;
    constructor(options: KvWebOptions);
    private factory;
    /** Open the database and create the store when missing, with a version bump, as the persistence adapter did. */
    private handle;
    private run;
    answer(op: KvOp, args: JsonValue[]): Promise<Settled<JsonValue, OsError>>;
    defer(op: KvOp, args: JsonValue[], key: string, deliver: (outcome: Settled<JsonValue, OsError>) => void): Settled<null, OsError>;
    cancel(key: string): boolean;
    close(): void;
}
declare function createKvWebPort(options: KvWebOptions): KvHostPort;

export { type KvBatchOp, type KvHostPort, type KvMode, type KvOp, type KvRequirement, type KvWebOptions, KvWebPort, createKvWebPort, kvDatabaseName, kvNamespace };
