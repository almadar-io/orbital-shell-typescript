import { credentialStorageKey, EntityRowSchema, isJsonObject, type EntityRow, type JsonValue } from '@almadar/core';
import type { ConnectFailure, ConnectFailureKind, CredentialGrantWire, CredentialStanding } from '@almadar/core/kernel-wire';

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
  connectBegin(grantJson: string): string;
  refreshBegin(name: string, principal?: string): string;
  connectFinish(ticket: number, status: number, body: string): string;
  connectAbandon(ticket: number): boolean;
}

/** What the kernel asks a host to POST to a token endpoint. The host decides nothing about it. */
export interface TokenRequest {
  endpoint: string;
  headers: Array<[string, string]>;
  body: string;
}

export interface TokenReply {
  status: number;
  body: string;
}

/** The host's one network capability the credential exchange needs: a form POST to an https token endpoint, no redirects followed. */
export type TokenEndpointPost = (request: TokenRequest) => Promise<TokenReply>;

/** A token exchange the kernel's store refused or the host could not carry; `kind` is the kernel's `ConnectFailureKind`. */
export class CredentialExchangeError extends Error {
  constructor(readonly kind: ConnectFailureKind, message: string) {
    super(message);
    this.name = 'CredentialExchangeError';
  }
}

const FAILURE_KINDS: readonly ConnectFailureKind[] = ['unavailable', 'unsigned', 'denied', 'invalid_grant', 'invalid_client', 'transport', 'malformed', 'refused'];

function failureOf(value: JsonValue | undefined): ConnectFailure {
  if (!isJsonObject(value)) throw new Error('the kernel connect failure is not an object');
  const kind = FAILURE_KINDS.find((known) => known === value.kind);
  if (kind === undefined) throw new Error('the kernel connect failure has an unknown kind');
  return { kind, message: textOf(value.message, 'failure message') };
}

function standingOf(value: JsonValue | undefined): CredentialStanding {
  if (!isJsonObject(value) || typeof value.connected !== 'boolean') throw new Error('the kernel credential standing is malformed');
  return { connected: value.connected, ...(typeof value.label === 'string' ? { label: value.label } : {}) };
}

function requestOf(value: JsonValue | undefined): { request: TokenRequest; ticket: number } {
  if (!isJsonObject(value) || !Array.isArray(value.headers)) throw new Error('the kernel token request is malformed');
  const headers: Array<[string, string]> = value.headers.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('the kernel token request header is malformed');
    return [textOf(pair[0], 'header name'), textOf(pair[1], 'header value')];
  });
  return { request: { endpoint: textOf(value.endpoint, 'token endpoint'), headers, body: textOf(value.body, 'token body') }, ticket: numberOf(value.ticket, 'exchange ticket') };
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
  entries: Array<{ service: string; name: string; last4?: string }>;
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
        const row = { service: textOf(entry.service, 'listing service'), name: textOf(entry.name, 'listing name') };
        return entry.last4 === undefined ? row : { ...row, last4: textOf(entry.last4, 'listing last4') };
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

  private readonly flights = new Map<string, Promise<string | undefined>>();
  private readonly turns = new Map<string, Promise<CredentialStanding>>();

  private async post(post: TokenEndpointPost, begun: { request: TokenRequest; ticket: number }): Promise<TokenReply> {
    try {
      return await post(begun.request);
    } catch (error) {
      this.kernel.connectAbandon(begun.ticket);
      throw new CredentialExchangeError('transport', error instanceof Error ? error.message : 'the token endpoint could not be reached');
    }
  }

  private async finish(ticket: number, reply: TokenReply): Promise<CredentialStanding> {
    const settled = objectOf(await this.exclusive(false, () => this.kernel.connectFinish(ticket, reply.status, reply.body)), 'connect outcome');
    if (settled.error !== undefined) {
      const failure = failureOf(settled.error);
      throw new CredentialExchangeError(failure.kind, failure.message);
    }
    return standingOf(settled.ok);
  }

  /** Exchange `grant` at its token endpoint through `post` and keep the result as the credential: the kernel builds the request and settles the reply, the host only sends. */
  async connect(grant: CredentialGrantWire, post: TokenEndpointPost): Promise<{ ok: CredentialStanding } | { error: ConnectFailure }> {
    try {
      const run = async (): Promise<CredentialStanding> => {
        const begun = objectOf(this.current().connectBegin(JSON.stringify(grant)), 'connect request');
        if (begun.error !== undefined) {
          const failure = failureOf(begun.error);
          throw new CredentialExchangeError(failure.kind, failure.message);
        }
        const request = requestOf(begun.ok);
        return this.finish(request.ticket, await this.post(post, request));
      };
      if (grant.grant !== 'refresh_token') return { ok: await run() };
      const key = credentialStorageKey({ name: grant.name, ...(grant.principal !== undefined ? { principal: grant.principal } : {}) });
      const previous = this.turns.get(key);
      const mine = (async (): Promise<CredentialStanding> => {
        await previous?.catch(() => undefined);
        return run();
      })();
      this.turns.set(key, mine);
      try {
        return { ok: await mine };
      } finally {
        if (this.turns.get(key) === mine) this.turns.delete(key);
      }
    } catch (error) {
      if (error instanceof CredentialExchangeError) return { error: { kind: error.kind, message: error.message } };
      throw error;
    }
  }

  /** The credential `envVar` for `principal`, refreshed first through `post` when it is past its expiry; concurrent resolves share one refresh. Undefined when nothing is held, nothing can renew it, or the provider refused (which drops the row). */
  async resolveFresh(envVar: string, principal: string | undefined, post: TokenEndpointPost): Promise<string | undefined> {
    const begun = objectOf(this.current().refreshBegin(envVar, principal), 'refresh outcome');
    if (begun.error !== undefined) {
      const failure = failureOf(begun.error);
      throw new CredentialExchangeError(failure.kind, failure.message);
    }
    const ok = begun.ok;
    if (!isJsonObject(ok)) throw new Error('the kernel refresh outcome is malformed');
    if (ok.exchange === undefined) return typeof ok.resolved === 'string' ? ok.resolved : undefined;
    const key = credentialStorageKey({ name: envVar, ...(principal !== undefined ? { principal } : {}) });
    const running = this.flights.get(key);
    if (running !== undefined) {
      this.current().connectAbandon(requestOf(ok.exchange).ticket);
      return running;
    }
    const request = requestOf(ok.exchange);
    const flight = (async (): Promise<string | undefined> => {
      try {
        await this.finish(request.ticket, await this.post(post, request));
      } catch (error) {
        if (error instanceof CredentialExchangeError && error.kind === 'invalid_grant') return undefined;
        throw error;
      }
      return this.resolve(envVar, principal);
    })();
    this.flights.set(key, flight);
    try {
      return await flight;
    } finally {
      this.flights.delete(key);
    }
  }

  /** Re-encrypt every row under the current master key; a row the kernel cannot read fails it before any row changes. */
  async rotate(): Promise<CredentialRotation> {
    const counts = objectOf(await this.exclusive(true, () => this.kernel.rotate()), 'rotation');
    return { rotated: numberOf(counts.rotated, 'rotated'), alreadyCurrent: numberOf(counts.alreadyCurrent, 'alreadyCurrent'), unreadable: numberOf(counts.unreadable, 'unreadable') };
  }
}
