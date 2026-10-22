// JSON transport ABI shared by the Node and WASM bindings; PersistenceAdapter owns the typed API.
export interface KernelMemoryStoreWire {
  getById(entityType: string, id: string): string;
  list(entityType: string): string;
  create(entityType: string, dataJson: string): string;
  update(entityType: string, id: string, dataJson: string): string;
  delete(entityType: string, id: string): void;
  queryPage(entityType: string, queryJson: string): string;
  queryIds(entityType: string, queryJson: string): string;
  writeWhere(opJson: string): string;
  writeBatch(batchJson: string): string;
  queryCapabilities(): string;
  writeCapabilities(): string;
  bindCollection(entityType: string, collection: string): void;
  clear(): void;
  snapshot(): string;
}

export interface KernelMemoryStoreExports {
  MemoryStore: new () => KernelMemoryStoreWire;
}
