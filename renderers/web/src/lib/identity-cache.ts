/**
 * The browser keeps the last identity frame its kernel folded (EXEC-IDENTITY-4) and seeds the next visit's kernel with
 * it, so a page's first render reads the viewer before the server's first frame lands. It is a display value only: the
 * kernel takes it only while no server frame has set one, the first server frame replaces it, and a signed-out frame
 * deletes it. A kv failure is a miss and never blocks the boot.
 */
import type { KvHostPort } from '@almadar/shell-browser/kv';

export interface IdentityKernel {
  seedIdentity(identityJson: string): boolean;
  sessionIdentity(): string | undefined;
}

const STORE = 'identity';
const KEY = 'last';

function signedIn(identityJson: string): boolean {
  const parsed: { user?: object | null } = JSON.parse(identityJson);
  return parsed.user !== undefined && parsed.user !== null;
}

export async function seedCachedIdentity(kernel: IdentityKernel, port: KvHostPort): Promise<void> {
  const read = await port.answer('kv/get', [STORE, KEY]);
  if (!('ok' in read)) return;
  const kept = read.ok;
  if (kept === null || typeof kept !== 'object' || Array.isArray(kept) || kept.found !== true || typeof kept.value !== 'string') return;
  kernel.seedIdentity(kept.value);
}

/** Call after each fold: keeps the kernel's identity when it changed; resolves whether it wrote. */
export function identityKeeper(kernel: IdentityKernel, port: KvHostPort): () => Promise<boolean> {
  let kept: string | undefined;
  return async () => {
    const now = kernel.sessionIdentity();
    if (now === undefined || now === kept) return false;
    kept = now;
    if (signedIn(now)) await port.answer('kv/put', [STORE, KEY, now]);
    else await port.answer('kv/delete', [STORE, KEY]);
    return true;
  };
}
