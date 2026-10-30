import { EntityRowSchema, isJsonObject, type EntityRow, type JsonValue } from '@almadar/core';

/**
 * The credential rows a host keeps over its medium (`chrome.storage`, files, Firestore). It answers four raw asks and
 * decides nothing: encryption, row shape, identity and every failure rule are the kernel's (`CredentialVault`, wasm).
 * `create` carries the id the kernel gave the row; `update` merges `data` over the row; `delete` answers whether this call
 * removed the row, and must do so atomically against other takers of the same medium: it is the conditional delete a
 * one-use value is taken with.
 */
export interface CredentialRowsPort {
  list(): Promise<EntityRow[]>;
  create(row: EntityRow & { id: string }): Promise<void>;
  update(id: string, data: EntityRow): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** The slice of the wasm `CredentialVault` class (`@almadar/kernel`) this handle uses; each result is JSON text. */
export interface CredentialVaultKernel {
  readonly enabled: boolean;
  load(rowsJson: string): number;
  resolve(name: string, principal?: string): string | undefined;
  label(name: string, principal?: string): string | undefined;
  snapshotEnv(): string;
  entries(principal?: string): string;
  listing(): string;
  set(service: string, name: string, value: string, principal?: string, label?: string): string;
  replace(name: string, value: string, principal?: string): string;
  persist(name: string, value: string, principal?: string, label?: string): string;
  remove(name: string, principal?: string): boolean;
  rotate(): string;
  takeWrites(): string;
}

/** A kernel module that carries the vault class: `import * as kernel from '@almadar/kernel/client'`. */
export interface CredentialVaultModule {
  CredentialVault: new (masterKey?: string, previousKey?: string) => CredentialVaultKernel;
}

/** Masked view of one stored credential, safe to return to a settings page. */
export interface CredentialEntry {
  service: string;
  envVar: string;
  last4: string;
  updatedAt: number;
  principal?: string;
}

export interface CredentialRotation {
  rotated: number;
  alreadyCurrent: number;
  unreadable: number;
}

export interface CredentialListing {
  enabled: boolean;
  entries: Array<{ service: string; name: string }>;
}

type RowWrite =
  | { write: 'create'; id: string; data: EntityRow & { id: string } }
  | { write: 'update'; id: string; data: EntityRow }
  | { write: 'delete'; id: string };

function parsed(json: string): JsonValue {
  return JSON.parse(json);
}

function objectOf(json: string, what: string): Record<string, JsonValue> {
  const value = parsed(json);
  if (!isJsonObject(value)) throw new Error(`the kernel ${what} is not an object`);
  return value;
}

function textOf(value: JsonValue | undefined, what: string): string {
  if (typeof value !== 'string') throw new Error(`the kernel ${what} is not text`);
  return value;
}

function numberOf(value: JsonValue | undefined, what: string): number {
  if (typeof value !== 'number') throw new Error(`the kernel ${what} is not a number`);
  return value;
}

function entryOf(value: JsonValue): CredentialEntry {
  if (!isJsonObject(value)) throw new Error('the kernel credential entry is not an object');
  return {
    service: textOf(value.service, 'entry service'),
    envVar: textOf(value.envVar, 'entry name'),
    last4: textOf(value.last4, 'entry last4'),
    updatedAt: numberOf(value.updatedAt, 'entry updatedAt'),
    ...(value.principal !== undefined ? { principal: textOf(value.principal, 'entry principal') } : {}),
  };
}

function writeOf(item: JsonValue): RowWrite {
  if (!isJsonObject(item)) throw new Error('the kernel credential write is not an object');
  const id = textOf(item.id, 'write id');
  if (item.write === 'delete') return { write: 'delete', id };
  const data = EntityRowSchema.parse(item.data);
  if (item.write === 'update') return { write: 'update', id, data };
  if (item.write === 'create') return { write: 'create', id, data: { ...data, id } };
  throw new Error('the kernel credential write is neither create, update nor delete');
}

/**
 * The host's handle on the kernel's encrypted credential store. The kernel keeps the rows the host last listed, runs every
 * operation (set, remove, rotate, resolution, masking) and records what changed; this handle lists the rows into
 * it and applies the recorded writes to the host's medium, one operation at a time. A row the kernel cannot read fails
 * `open` and every operation after it: nothing here reads a broken store as an empty one.
 */
export class CredentialVault {
  private readonly listeners = new Set<(principal?: string) => void>();
  private queue: Promise<void> = Promise.resolve();
  private broken = false;

  private constructor(
    private readonly kernel: CredentialVaultKernel,
    private readonly rows: CredentialRowsPort,
  ) {}

  /** List the host's rows into the kernel and read them; rejects naming the rows it cannot read. */
  static async open(kernel: CredentialVaultKernel, rows: CredentialRowsPort): Promise<CredentialVault> {
    const vault = new CredentialVault(kernel, rows);
    await vault.reload();
    return vault;
  }

  /** True when a valid master key is present (writes and decryption enabled). */
  get enabled(): boolean {
    return this.kernel.enabled;
  }

  /** Subscribe to credential changes; returns an unsubscribe function. */
  subscribe(listener: (principal?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(principal?: string): void {
    for (const listener of this.listeners) listener(principal);
  }

  private async reload(): Promise<void> {
    try {
      this.kernel.load(JSON.stringify(await this.rows.list()));
      this.broken = false;
    } catch (error) {
      this.broken = true;
      throw error;
    }
  }

  private current(): CredentialVaultKernel {
    if (this.broken) throw new Error('the credential store could not be read or written; reload it');
    return this.kernel;
  }

  private async apply(): Promise<void> {
    const writes = parsed(this.kernel.takeWrites());
    if (!Array.isArray(writes)) throw new Error('the kernel credential writes are not a list');
    try {
      for (const item of writes) {
        const write = writeOf(item);
        if (write.write === 'create') await this.rows.create(write.data);
        else if (write.write === 'update') await this.rows.update(write.id, write.data);
        else await this.rows.delete(write.id);
      }
    } catch (error) {
      this.broken = true;
      throw error;
    }
  }

  /** One operation at a time: the kernel runs it, then its writes reach the medium before the next begins. */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private exclusive<T>(fresh: boolean, work: () => T, principal?: string): Promise<T> {
    return this.serial(async () => {
      if (fresh || this.broken) await this.reload();
      let result: T;
      try {
        result = work();
      } catch (error) {
        if (this.kernel.takeWrites() !== '[]') this.broken = true;
        throw error;
      }
      await this.apply();
      this.notify(principal);
      return result;
    });
  }

  /** Resolve one credential by name (warmed values only). */
  resolve(envVar: string, principal?: string): string | undefined {
    return this.current().resolve(envVar, principal);
  }

  /** The non-secret account label stored in the clear beside a credential's ciphertext; undefined when its row carries none. */
  label(envVar: string, principal?: string): string | undefined {
    return this.current().label(envVar, principal);
  }

  /** All app-wide values as an env-shaped map, for merging over the process env. */
  snapshotEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(objectOf(this.current().snapshotEnv(), 'environment'))) env[name] = textOf(value, 'environment value');
    return env;
  }

  /** Masked entries for display — never includes plaintext. */
  entries(principal?: string): CredentialEntry[] {
    const entries = parsed(this.current().entries(principal));
    if (!Array.isArray(entries)) throw new Error('the kernel credential entries are not a list');
    return entries.map(entryOf);
  }

  /** Whether the store can encrypt and the service and name of every app-wide row. */
  listing(): CredentialListing {
    const listing = objectOf(this.current().listing(), 'listing');
    const entries = listing.entries;
    if (!Array.isArray(entries) || typeof listing.enabled !== 'boolean') throw new Error('the kernel credential listing is malformed');
    return {
      enabled: listing.enabled,
      entries: entries.map((entry) => {
        if (!isJsonObject(entry)) throw new Error('the kernel credential listing holds a row that is not an object');
        return { service: textOf(entry.service, 'listing service'), name: textOf(entry.name, 'listing name') };
      }),
    };
  }

  /** Upsert one credential; `label` is a non-secret account name kept in the clear beside it, left out it stays as it is. */
  async set(service: string, envVar: string, value: string, principal?: string, label?: string): Promise<CredentialEntry> {
    return entryOf(parsed(await this.exclusive(false, () => this.kernel.set(service, envVar, value, principal, label), principal)));
  }

  /** Replace the value of a credential already stored, keeping its service (a rotated refresh token). */
  async replace(envVar: string, value: string, principal?: string): Promise<CredentialEntry> {
    return entryOf(parsed(await this.exclusive(false, () => this.kernel.replace(envVar, value, principal), principal)));
  }

  /** Keep `value` as the credential until it is forgotten, creating it when absent. */
  async persist(envVar: string, value: string, principal?: string, label?: string): Promise<CredentialEntry> {
    return entryOf(parsed(await this.exclusive(false, () => this.kernel.persist(envVar, value, principal, label), principal)));
  }

  /** Delete one credential row; whether one existed. */
  remove(envVar: string, principal?: string): Promise<boolean> {
    return this.exclusive(false, () => this.kernel.remove(envVar, principal), principal);
  }

  /** Re-encrypt every row under the current master key; a row the kernel cannot read fails it before any row changes. */
  async rotate(): Promise<CredentialRotation> {
    const counts = objectOf(await this.exclusive(true, () => this.kernel.rotate()), 'rotation');
    return { rotated: numberOf(counts.rotated, 'rotated'), alreadyCurrent: numberOf(counts.alreadyCurrent, 'alreadyCurrent'), unreadable: numberOf(counts.unreadable, 'unreadable') };
  }
}
