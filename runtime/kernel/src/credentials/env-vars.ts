/** Env var holding the 64-char-hex AES-256 master key (Secret Manager in production). */
export const CREDENTIAL_MASTER_KEY_ENV = 'ALMADAR_CREDENTIAL_MASTER_KEY';

/** Env var holding the PREVIOUS master key during a rotation window: `rotate` re-encrypts every row under the current key, then the previous key is retired. */
export const CREDENTIAL_PREVIOUS_MASTER_KEY_ENV = 'ALMADAR_CREDENTIAL_MASTER_KEY_PREVIOUS';

/**
 * Bootstrap secrets that must NEVER enter store custody: the master key(s)
 * decrypt the store itself, so seeding them as rows (encrypted under
 * themselves) or stripping them from the env would be circular.
 */
export const STORE_BOOTSTRAP_ENV_VARS: ReadonlySet<string> = new Set([CREDENTIAL_MASTER_KEY_ENV, CREDENTIAL_PREVIOUS_MASTER_KEY_ENV]);

/**
 * Every env var a forked verify/harness process must not inherit so it can never see, and therefore
 * never spend, a real credential: the store's bootstrap keys. A program's own credentials are declared
 * in the program (`program_credentials` in the kernel) and held in the store, never in the fork's env.
 */
export function allCredentialEnvVars(): Set<string> {
  return new Set(STORE_BOOTSTRAP_ENV_VARS);
}
