/** The credential store of a browser host: the server host's encrypted rows over `chrome.storage`, never a second store. */
import { EntityRowSchema, FULL_WRITE_CAPABILITIES, runRowWrite, type EntityRow } from '@almadar/core';
import { CREDENTIAL_ENTITY_TYPE, CredentialStore, DERIVED_ENTITY_TYPE, type CredentialPersistence, type DerivedPersistence } from '@almadar/shell-web';

/** The slice of `chrome.storage` a browser host keeps its rows in. */
export interface ChromeStorageArea {
  get(key: string): Promise<Record<string, object>>;
  set(items: Record<string, object>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const CHROME_CREDENTIAL_ROWS_KEY = 'almadar.credentials.rows';
export const CHROME_DERIVED_ROWS_KEY = 'almadar.credentials.derived';
export const CHROME_CREDENTIAL_MASTER_KEY = 'almadar.credentials.masterKey';

/** The store's rows kept as one array per entity type under one `chrome.storage` key each; writes are applied one after another. */
export function chromeCredentialRows(storage: ChromeStorageArea): CredentialPersistence & DerivedPersistence {
  let queue: Promise<unknown> = Promise.resolve();
  const keyOf = (entityType: string): string => {
    if (entityType === CREDENTIAL_ENTITY_TYPE) return CHROME_CREDENTIAL_ROWS_KEY;
    if (entityType === DERIVED_ENTITY_TYPE) return CHROME_DERIVED_ROWS_KEY;
    throw new Error(`the chrome credential store holds no ${entityType} rows`);
  };
  const read = async (key: string): Promise<EntityRow[]> => {
    const held = (await storage.get(key))[key];
    if (held === undefined) return [];
    const rows = EntityRowSchema.array().safeParse(held);
    if (!rows.success) throw new Error(`the credential rows under ${key} are unreadable: ${rows.error.message}`);
    return rows.data;
  };
  const write = (key: string, rows: EntityRow[]): Promise<void> => storage.set({ [key]: rows });
  const change = <T>(entityType: string, work: (rows: EntityRow[], key: string) => Promise<T> | T): Promise<T> => {
    const key = keyOf(entityType);
    const next = queue.then(async () => work(await read(key), key));
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    async list(entityType) {
      const key = keyOf(entityType);
      await queue;
      return read(key);
    },
    async getById(entityType, id) {
      const key = keyOf(entityType);
      await queue;
      return (await read(key)).find((row) => row.id === id) ?? null;
    },
    create: (entityType, data) =>
      change(entityType, async (rows, key) => {
        const id = typeof data.id === 'string' ? data.id : globalThis.crypto.randomUUID();
        await write(key, [...rows, { ...data, id }]);
        return { id };
      }),
    update: (entityType, id, data) =>
      change(entityType, async (rows, key) => {
        await write(key, rows.map((row) => (row.id === id ? { ...row, ...data, id } : row)));
      }),
    delete: (entityType, id) =>
      change(entityType, async (rows, key) => {
        await write(key, rows.filter((row) => row.id !== id));
      }),
    writeCapabilities: () => FULL_WRITE_CAPABILITIES,
    writeWhere: (op) =>
      change(op.entityType, async (rows, key) => {
        const result = runRowWrite(rows, op);
        const { kind } = result.outcome;
        if (kind === 'created' || kind === 'updated' || kind === 'deleted') await write(key, result.rows);
        return result.outcome;
      }),
  };
}

function randomMasterKey(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The warmed credential store of this browser profile. Its master key is minted on first use and kept in the same
 * extension storage, so the rows stay in the server host's format while the browser's own storage isolation is what protects them.
 */
export async function createChromeCredentialStore(storage: ChromeStorageArea): Promise<CredentialStore> {
  const held = (await storage.get(CHROME_CREDENTIAL_MASTER_KEY))[CHROME_CREDENTIAL_MASTER_KEY];
  let masterKey = typeof held === 'object' && 'key' in held && typeof held.key === 'string' ? held.key : undefined;
  if (masterKey === undefined) {
    masterKey = randomMasterKey();
    await storage.set({ [CHROME_CREDENTIAL_MASTER_KEY]: { key: masterKey } });
  }
  const store = new CredentialStore(chromeCredentialRows(storage), masterKey);
  await store.warm();
  return store;
}
