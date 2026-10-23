import { OAuthEffectFailurePayload, RuntimeValue, OAuthAuthorizePayload, OAuthConnectionPayload } from '@almadar/core';
import { HttpPorts } from './http.js';
import './beacon.js';
import '../credentials/store.js';
import './decode.js';
import '@almadar/core/kernel-wire';

/**
 * The interpreter and kernel-host half of the OAuth effects (`oauth-authorize`, `oauth-connection-status`,
 * `oauth-connection-forget`): the asks that orbital-core's `run_oauth_authorize` / `run_oauth_connection` make,
 * in the same order, answered here. Every rule (client and option parsing, the authorization URL, the failure
 * messages) is the kernel's, reached through `@almadar/kernel`; only the sequencing of host asks lives here.
 */

/** A failed OAuth effect: its payload is what the `emit.failure` route carries. */
declare class OAuthEffectFailure extends Error {
    readonly payload: OAuthEffectFailurePayload;
    constructor(payload: OAuthEffectFailurePayload);
}
/** `oauth-authorize`: the kernel's steps, in order — secret, metadata, two draws, pending grant. */
declare function oauthAuthorizePayload(ports: HttpPorts, client: RuntimeValue | undefined, options: RuntimeValue | undefined, principal: string | undefined, key?: RuntimeValue): Promise<OAuthAuthorizePayload>;
/** `oauth-connection-status` / `oauth-connection-forget`: store first, then caller (the legacy order). */
declare function oauthConnectionPayload(ports: HttpPorts, head: 'oauth-connection-status' | 'oauth-connection-forget', provider: RuntimeValue | undefined, principal: string | undefined): Promise<OAuthConnectionPayload>;

export { OAuthEffectFailure, oauthAuthorizePayload, oauthConnectionPayload };
