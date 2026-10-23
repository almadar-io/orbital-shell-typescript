import { HttpSecrets, OAuthPort } from './http.js';
import '@almadar/core';
import './beacon.js';
import '../credentials/store.js';
import './decode.js';
import '@almadar/core/kernel-wire';

/** What the person's consent page is opened with. */
interface OAuthConsentRequest {
    authUrl: string;
    state: string;
    redirectUri: string;
}
interface OAuthPortOptions {
    /** The host's credentials (read per ask when a function: a host installs them at boot). */
    secrets: HttpSecrets | (() => HttpSecrets);
    /** The host clock in epoch milliseconds. */
    now?: () => number;
    /** Opens the consent page for the person and answers the authorization code it returned, `null` when they declined; absent, the host asks no one. */
    consent?: (request: OAuthConsentRequest) => Promise<string | null>;
}
/**
 * The port's clock decides expiry (`expiresAt >= now` is live, the inclusive boundary of the native store); the
 * credential only garbage-collects, so it is given a grace beyond the TTL and an expired state answers `expired`,
 * not `missing`.
 */
declare const PENDING_GRACE_MS: number;
declare function createOAuthPort(options: OAuthPortOptions): OAuthPort;

export { type OAuthConsentRequest, type OAuthPortOptions, PENDING_GRACE_MS, createOAuthPort };
