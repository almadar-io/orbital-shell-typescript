import { userCredentialKey, type SecretStore } from '@almadar/shell-runtime';

export function memorySecrets(initial: { [name: string]: string }, rotatable = true): SecretStore & { held: Map<string, string> } {
  const held = new Map(Object.entries(initial));
  return {
    held,
    ...(rotatable ? { async rotate(name: string, value: string, principal?: string) {
      const key = principal === undefined ? name : userCredentialKey(principal, name);
      if (!held.has(key)) throw new Error(`credential ${name} is not stored`);
      held.set(key, value);
    } } : {}),
    async get(name, principal) { return held.get(principal === undefined ? name : userCredentialKey(principal, name)); },
    async set(name, value, ttlMs, principal) {
      const key = principal === undefined ? name : userCredentialKey(principal, name);
      if (ttlMs <= 0) held.delete(key); else held.set(key, value);
    },
    async forget(name, principal) { held.delete(principal === undefined ? name : userCredentialKey(principal, name)); },
  };
}
