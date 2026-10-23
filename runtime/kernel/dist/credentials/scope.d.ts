import { CredentialStore } from './store.js';
import '@almadar/core';

/** Whether integrations answer with mock data or call their real backends. */
type CredentialMode = 'mock' | 'real';
/** The mode an env asks for: `ALMADAR_INTEGRATIONS_MODE=mock` or `USE_MOCK_DATA=true` mean mock. */
declare function credentialModeFromEnv(env: Record<string, string | undefined>): CredentialMode;
/** The host's live mode switch, reachable from the kernel's `credential-mode` asks. */
interface CredentialModeControl {
    readonly mode: CredentialMode;
    setMode(mode: CredentialMode): void;
}
/** The per-tenant credential scope: a Node host installs AsyncLocalStorage (`@almadar/shell-node`); a browser has none. */
interface CredentialScopeStorage {
    run<T>(store: CredentialStore, fn: () => T): T;
    getStore(): CredentialStore | undefined;
}
declare function installCredentialScopeStorage(storage: CredentialScopeStorage): void;
/**
 * Run `fn` as one tenant of a multi-tenant host: every credential reference resolved inside it
 * (across awaits) comes from `store` alone, never from the host's env or installed store.
 */
declare function runWithCredentialScope<T>(store: CredentialStore, fn: () => T): T;
/** The host's mode switch, installed beside its credential store. */
declare function installModeControl(control: CredentialModeControl): void;
declare function getModeControl(): CredentialModeControl | null;
/**
 * Install the host's credential store as the process-wide resolution source.
 * Called once at boot (playground / generated server) after the store is
 * constructed over the host's persistence adapter.
 */
declare function installCredentialStore(store: CredentialStore): void;
/** The installed store, for the credentials admin service. */
declare function getInstalledCredentialStore(): CredentialStore | null;
declare function getEffectiveCredentialStore(): CredentialStore | null;
/** Testing/reset hook. */
declare function uninstallCredentialStore(): void;
/** The env var selecting store-only resolution (the kernel rule `credential_admin::SOURCE_VAR`). */
declare const CREDENTIALS_SOURCE_ENV = "ALMADAR_CREDENTIALS_SOURCE";
/** Whether `env` selects store-only resolution: exactly `ALMADAR_CREDENTIALS_SOURCE=store`. */
declare function credentialsFromStoreOnly(env: Record<string, string | undefined>): boolean;
/**
 * The one credential-reference resolver: store, then env, then undefined; inside a tenant's
 * credential scope, that tenant's store only. With `ALMADAR_CREDENTIALS_SOURCE=store` every
 * name but a host setting answers from the store alone, never from the env. `ref` is an env-var name.
 */
declare function resolveCredentialRef(ref: string, env?: Record<string, string | undefined>, principal?: string): string | undefined;

export { CREDENTIALS_SOURCE_ENV, type CredentialMode, type CredentialModeControl, type CredentialScopeStorage, credentialModeFromEnv, credentialsFromStoreOnly, getEffectiveCredentialStore, getInstalledCredentialStore, getModeControl, installCredentialScopeStorage, installCredentialStore, installModeControl, resolveCredentialRef, runWithCredentialScope, uninstallCredentialStore };
