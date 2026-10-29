/**
 * The `http` ports of a browser-extension host that holds credentials: the browser's own `fetch` for the bytes, and the
 * profile's credential vault (the kernel's encrypted rows, kept in `chrome.storage`) for every secret the kernel
 * asks. A program names a credential and the kernel resolves it here; no value is ever answered to the program.
 */
import { createBrowserHttpPorts, createHttpSecrets, type BrowserHttpPortsOptions, type CredentialVault, type HttpPorts } from '@almadar/shell-web';

/** A credential the host keeps because a sign-in succeeded: the value stays with the host, `label` is the non-secret account name. */
export interface SignedInCredential {
  name: string;
  value: string;
  label: string;
}

export interface ExtensionHttpPortsOptions extends BrowserHttpPortsOptions {
  /** The kernel's credential vault of this browser profile, its rows read. */
  credentials: Promise<CredentialVault>;
  /** Credentials the build supplies (an OAuth client id), read when the store holds none and only for the app-wide credential. */
  provisioned?: Readonly<Record<string, string>>;
}

export function createExtensionHttpPorts(options: ExtensionHttpPortsOptions): HttpPorts {
  const provisioned = new Map(Object.entries(options.provisioned ?? {}));
  const secrets = createHttpSecrets(Date.now, {
    store: () => options.credentials,
    async resolve(name, principal) {
      const held = (await options.credentials).resolve(name, principal);
      return held ?? (principal === undefined ? provisioned.get(name) : undefined);
    },
  });
  return {
    ...createBrowserHttpPorts(options),
    secrets,
  };
}
