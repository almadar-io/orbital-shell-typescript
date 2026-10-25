/** The credential rows of a browser host over `chrome.storage`, and the master key it hands the kernel's vault. */
import { EntityRowSchema, runRowWrite, type EntityRow } from '@almadar/core';
import { CredentialVault, type CredentialRowsPort, type CredentialVaultModule } from '@almadar/shell-web';

/** The slice of `chrome.storage` a browser host keeps its rows in. */
export interface ChromeStorageArea {
  get(key: string): Promise<Record<string, object>>;
  set(items: Record<string, object>): Promise<void>;
  remove(key: string): Promise<void>;
}

const CREDENTIAL_ROWS_ENTITY = 'AlmadarIntegrationCredential';

export const CHROME_CREDENTIAL_ROWS_KEY = 'almadar.credentials.rows';
export const CHROME_CREDENTIAL_MASTER_KEY = 'almadar.credentials.masterKey';

/** The writes to one storage area, in order: every rows port over the same area in this context shares one. */
const gates = new WeakMap<ChromeStorageArea, { tail: Promise<void> }>();

function gateOf(storage: ChromeStorageArea): { tail: Promise<void> } {
  const held = gates.get(storage);
  if (held !== undefined) return held;
  const gate = { tail: Promise.resolve() };
  gates.set(storage, gate);
  return gate;
}

/**
 * The kernel's rows kept as one array under one `chrome.storage` key; reads and writes are applied one after another, so a
 * conditional delete (`runRowWrite`) is atomic against every other rows port over the same area in this context.
 * `chrome.storage` has no compare-and-set, so another extension context (a popup, a second worker) is not covered.
 */
export function chromeCredentialRows(storage: ChromeStorageArea): CredentialRowsPort {
  const gate = gateOf(storage);
  const key = CHROME_CREDENTIAL_ROWS_KEY;
  const read = async (): Promise<EntityRow[]> => {
    const held = (await storage.get(key))[key];
    if (held === undefined) return [];
    const rows = EntityRowSchema.array().safeParse(held);
    if (!rows.success) throw new Error(`the credential rows under ${key} are unreadable: ${rows.error.message}`);
    return rows.data;
  };
  const change = <T>(work: (rows: EntityRow[]) => { rows: EntityRow[]; result: T }): Promise<T> => {
    const next = gate.tail.then(async () => {
      const { rows, result } = work(await read());
      await storage.set({ [key]: rows });
      return result;
    });
    gate.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    async list() {
      await gate.tail;
      return read();
    },
    create: (row) => change((rows) => ({ rows: [...rows, row], result: undefined })),
    update: (id, data) => change((rows) => ({ rows: rows.map((row) => (row.id === id ? { ...row, ...data, id } : row)), result: undefined })),
    delete: (id) =>
      change((rows) => {
        const written = runRowWrite(rows, { kind: 'delete', entityType: CREDENTIAL_ROWS_ENTITY, id });
        return { rows: written.rows, result: written.outcome.kind === 'deleted' };
      }),
  };
}

function randomMasterKey(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The credential vault of this browser profile. Its master key is minted on first use and kept in the same extension
 * storage, so the browser's own storage isolation is what protects the rows; the kernel encrypts and reads them.
 */
export async function createChromeCredentialVault(storage: ChromeStorageArea, kernel: CredentialVaultModule): Promise<CredentialVault> {
  const held = (await storage.get(CHROME_CREDENTIAL_MASTER_KEY))[CHROME_CREDENTIAL_MASTER_KEY];
  let masterKey = typeof held === 'object' && 'key' in held && typeof held.key === 'string' ? held.key : undefined;
  if (masterKey === undefined) {
    masterKey = randomMasterKey();
    await storage.set({ [CHROME_CREDENTIAL_MASTER_KEY]: { key: masterKey } });
  }
  return CredentialVault.open(new kernel.CredentialVault(masterKey), chromeCredentialRows(storage));
}
