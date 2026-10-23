import { EntityRow, PersistenceAdapter, WriteCapabilities, RowCommit } from '@almadar/core';

/**
 * IndexedDbPersistence — the browser store for `[persistent: x, local]` entities.
 *
 * Implements the shared `PersistenceAdapter` contract, so the effect stage runs
 * `fetch`/`persist` against it exactly as a server runs them against Firestore
 * or Postgres. Sync-ready: minted ids are UUIDs, every write stamps `updatedAt`
 * and appends to an ordered change log (`__changes`) a later sync can replay.
 * It answers plain reads; the kernel filters, orders and windows rows itself. Writes arrive as one
 * compare-and-commit of rows the kernel decided (EXEC-STORE-5), so the store holds no query or write semantics.
 *
 * @packageDocumentation
 */

/** Object store holding the append-only write log. */
declare const CHANGE_LOG = "__changes";
interface ChangeRecord {
    op: "create" | "update" | "delete";
    entityType: string;
    id: string;
    row: EntityRow | null;
    at: string;
}
interface IndexedDbPersistenceOptions {
    /** One database per app, e.g. `almadar:<app name>`. */
    databaseName: string;
    /** Every browser-stored entity type this store holds (one object store each). */
    entityTypes: readonly string[];
    /** IndexedDB implementation; defaults to the browser's `indexedDB`. */
    factory?: IDBFactory;
    /** Clock for `updatedAt` / change stamps; defaults to `new Date().toISOString()`. */
    now?: () => string;
}
declare class IndexedDbPersistence implements PersistenceAdapter {
    private readonly db;
    private readonly entityTypes;
    private readonly now;
    private constructor();
    /** Open (creating or upgrading) the database so it holds every listed entity type. */
    static open(options: IndexedDbPersistenceOptions): Promise<IndexedDbPersistence>;
    close(): void;
    private store;
    private write;
    create(entityType: string, data: EntityRow): Promise<{
        id: string;
    }>;
    update(entityType: string, id: string, data: EntityRow): Promise<void>;
    delete(entityType: string, id: string): Promise<void>;
    getById(entityType: string, id: string): Promise<EntityRow | null>;
    list(entityType: string): Promise<EntityRow[]>;
    writeCapabilities(_entityType: string): WriteCapabilities;
    /** The kernel's decided rows, applied in one readwrite transaction only if each row still equals the version it read (EXEC-STORE-5). */
    commitRows(rows: readonly RowCommit[]): Promise<boolean>;
    countRows(entityType: string): Promise<number>;
    /** The write log, oldest first — the seam a later `sync` replays. */
    changes(): Promise<ChangeRecord[]>;
}

export { CHANGE_LOG, type ChangeRecord, IndexedDbPersistence, type IndexedDbPersistenceOptions };
