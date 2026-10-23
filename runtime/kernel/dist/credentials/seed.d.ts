import { CredentialStore } from './store.js';
import '@almadar/core';

/** One credential the app declares: the service group it belongs to and the env var / credential name. */
interface DeclaredCredential {
    readonly service: string;
    readonly envVar: string;
}
/** The kernel export that decides a seed (`credential_admin::seed_plan`): the rows to copy, never a value. */
interface CredentialSeedKernel {
    credentialSeedPlan(declaredJson: string, heldJson: string, presentJson: string): string;
}
/**
 * The boot of `ALMADAR_CREDENTIALS_SOURCE=store`: the kernel plans which declared credentials the store lacks and the env
 * holds, and this copies each into the store, so the env stays the way to hand a deployment its first keys. A name
 * declared twice seeds once, a held row is never overwritten. Returns the count.
 */
declare function seedCredentialStore(store: CredentialStore, declared: readonly DeclaredCredential[], env: Record<string, string | undefined>, kernel: CredentialSeedKernel): Promise<number>;

export { type CredentialSeedKernel, type DeclaredCredential, seedCredentialStore };
