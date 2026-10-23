import { PersistenceAdapter, KernelMemoryStoreWire, EntityRow, RowQuery, RowQueryPage, RowIdPage, QueryCapabilities, RowWriteOp, RowWriteOutcome, RowWriteBatch, WriteCapabilities } from '@almadar/core';

declare class NativeMemoryWriteError extends Error {
    readonly outcome: RowWriteOutcome;
    constructor(outcome: RowWriteOutcome);
}
declare class NativeMemoryPersistenceAdapter implements PersistenceAdapter {
    readonly store: KernelMemoryStoreWire;
    constructor(store: KernelMemoryStoreWire);
    getById(entityType: string, id: string): Promise<EntityRow | null>;
    list(entityType: string): Promise<EntityRow[]>;
    create(entityType: string, data: EntityRow): Promise<{
        id: string;
    }>;
    update(entityType: string, id: string, data: EntityRow): Promise<void>;
    delete(entityType: string, id: string): Promise<void>;
    queryPage(entityType: string, query: RowQuery): Promise<RowQueryPage>;
    queryIds(entityType: string, query: RowQuery): Promise<RowIdPage>;
    queryCapabilities(_entityType: string): QueryCapabilities;
    writeWhere(op: RowWriteOp): Promise<RowWriteOutcome>;
    writeBatch(batch: RowWriteBatch): Promise<RowWriteOutcome[]>;
    writeCapabilities(_entityType: string): WriteCapabilities;
    bindCollection(entityType: string, collection: string): void;
    clear(): void;
    snapshot(): Record<string, EntityRow[]>;
}

export { NativeMemoryPersistenceAdapter, NativeMemoryWriteError };
