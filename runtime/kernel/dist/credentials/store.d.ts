import { PersistenceAdapter, CredentialIdentity } from '@almadar/core';

/** Entity type the credential rows persist under (never a `.lolo`-declared entity). */
declare const CREDENTIAL_ENTITY_TYPE = "AlmadarIntegrationCredential";
/** Env var holding the 64-char-hex AES-256 master key (Secret Manager in production). */
declare const CREDENTIAL_MASTER_KEY_ENV = "ALMADAR_CREDENTIAL_MASTER_KEY";
/**
 * Env var holding the PREVIOUS master key during a rotation window (I-28):
 * decryption tries the row's stamped key, `rotate()` re-encrypts every row
 * under the current key, then the previous key is retired from the env.
 */
declare const CREDENTIAL_PREVIOUS_MASTER_KEY_ENV = "ALMADAR_CREDENTIAL_MASTER_KEY_PREVIOUS";
/** The slice of the persistence contract the credential store uses. */
type CredentialPersistence = Pick<PersistenceAdapter, 'create' | 'update' | 'delete' | 'list'>;
/** Entity type the shared one-use values (a pending OAuth grant) persist under. */
declare const DERIVED_ENTITY_TYPE = "AlmadarKernelDerivedSecret";
/** What an adapter also offers when it can share one-use values across instances: a read by id, and a conditional delete where the store has one. */
type DerivedPersistence = Pick<PersistenceAdapter, 'getById'> & Partial<Pick<PersistenceAdapter, 'writeWhere' | 'writeCapabilities'>>;
/** Masked view of one stored credential — safe to return to a settings page. */
interface CredentialEntry {
    service: string;
    envVar: string;
    last4: string;
    updatedAt: number;
    principal?: CredentialIdentity['principal'];
}
/**
 * Tenant-scoped (app-wide) credential store: one AES-256-GCM-encrypted row
 * per (service, envVar) through the host's persistence adapter, master key
 * `ALMADAR_CREDENTIAL_MASTER_KEY` held alone in the platform secret store.
 *
 * Resolution contract: credential keys ARE env-var names (the same names
 * `serviceCredentials` declares and `connectionRef` carries), so a stored
 * value transparently shadows its env counterpart — store → env →
 * unconfigured, everywhere.
 *
 * `warm()` decrypts all rows into memory so resolution stays synchronous;
 * every write re-warms the affected entry and notifies subscribers (the
 * `RuntimeIntegrationManager` re-configures on that signal, so new keys go
 * live without a restart).
 */
declare class CredentialStore {
    private readonly adapter;
    private readonly masterKeyHex;
    private readonly previousKeyHex;
    private readonly byIdentity;
    private readonly listeners;
    private warmed;
    constructor(adapter: CredentialPersistence, masterKey?: string, previousMasterKey?: string);
    /** True when a valid master key is present (writes and decryption enabled). */
    get enabled(): boolean;
    /** Subscribe to credential changes; returns an unsubscribe function. */
    subscribe(listener: (principal?: string) => void): () => void;
    private notify;
    private encrypt;
    private decryptWithKey;
    /**
     * Decrypt one row, selecting the key by the row's stamped `keyId` (I-28):
     * current key first, then the rotation-window previous key. Legacy rows
     * (no `keyId`) try current then previous. Returns null when no held key
     * decrypts the row — the row is unreadable, never silently wrong (GCM
     * auth tags make a wrong-key success impossible).
     */
    private decryptRow;
    /**
     * Load and decrypt every stored row into memory. Returns the number of
     * resolvable credentials. Without a master key nothing decrypts (rows are
     * left in place, resolution falls through to env).
     */
    warm(): Promise<number>;
    /** Resolve one credential by env-var name (warmed values only). */
    resolve(envVar: string, principal?: string): string | undefined;
    /** The non-secret account label stored in the clear beside a credential's ciphertext; undefined when its row carries none. */
    label(envVar: string, principal?: string): string | undefined;
    /** All warmed values as an env-shaped map, for merging over the process env. */
    snapshotEnv(): Record<string, string>;
    /** Masked entries for display — never includes plaintext. */
    entries(principal?: string): CredentialEntry[];
    /**
     * Upsert one credential (encrypts, persists, re-warms the entry, notifies). `label` is a non-secret account name kept
     * in the clear in the row beside the ciphertext; left out, the row's label stays as it is.
     */
    set(service: string, envVar: string, value: string, principal?: string, label?: string): Promise<CredentialEntry>;
    /**
     * Re-encrypt every readable row under the CURRENT master key (I-28).
     * Rotation window: deploy the new key as `ALMADAR_CREDENTIAL_MASTER_KEY`
     * with the old one as `..._PREVIOUS`, call `rotate()`, then retire the
     * previous key. Rows no held key can read are counted, never dropped.
     */
    rotate(): Promise<{
        rotated: number;
        alreadyCurrent: number;
        unreadable: number;
    }>;
    /** Whether one-use values are shared through the adapter: a master key and an adapter that reads a row by id. */
    get sharesDerived(): boolean;
    /** Keep `value` encrypted in the adapter until `expiresAt` (epoch ms) so any instance on the same store can take it once. */
    holdDerived(name: string, value: string, expiresAt: number, principal?: string): Promise<void>;
    /**
     * Remove and return a held value. Where the adapter has a conditional delete only the instance whose delete
     * lands gets the value; elsewhere the delete is unconditional, so two instances racing for one state can both
     * read it. An expired value is consumed and not returned.
     */
    takeDerived(name: string, principal: string | undefined, now: number): Promise<string | undefined>;
    /** Delete one credential row; resolution falls back to env afterwards. */
    remove(envVar: string, principal?: string): Promise<boolean>;
}

export { CREDENTIAL_ENTITY_TYPE, CREDENTIAL_MASTER_KEY_ENV, CREDENTIAL_PREVIOUS_MASTER_KEY_ENV, type CredentialEntry, type CredentialPersistence, CredentialStore, DERIVED_ENTITY_TYPE, type DerivedPersistence };
