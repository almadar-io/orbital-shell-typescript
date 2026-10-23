import { HttpFailurePayload, JsonValue, HttpStreamEvent, RuntimeValue, CredentialPayload, HttpOAuthFailureCode, HttpOAuthFailureReason, HttpCall } from '@almadar/core';
export { HttpCall } from '@almadar/core';
import { BeaconDeliveryPorts } from './beacon.js';
import { CredentialStore } from '../credentials/store.js';
export { decodeOAuthAsk } from './decode.js';
import { IoRequestWire, OAuthAsk, OAuthReply, HttpResponseWire, HttpFailureWire, HttpRequestWire } from '@almadar/core/kernel-wire';

/**
 * The one TypeScript half of the `http` effect: the host side that moves the bytes the Rust request builder
 * (`@almadar/kernel`, wasm) produced. Both the kernel host (`host.ts`) and the interpreter (`EffectExecutor`)
 * call it; nothing here builds a request, frames a stream or shapes a payload — the wasm exports do.
 */

/**
 * The pure half of `oauth-authorize` (`@almadar/kernel` `oauthAuthorizePlan` / `oauthAuthorizeBuild` / `oauthFailure`);
 * a kernel build without them cannot run the effect.
 */
interface OAuthAuthorizeKernel {
    /** Parses the client and options: `{ plan, clientId: { name, scope }, issuer, metadata }`; throws the effect's failure message. */
    oauthAuthorizePlan(clientJson: string, optionsJson: string): string;
    /** `{ ok: { authUrl, state, grant } }`, `{ failure: OAuthEffectFailurePayload }` or `{ refused: string }`. */
    oauthAuthorizeBuild(planJson: string, clientId: string, metadataJson: string, stateBase64: string, verifierBase64: string): string;
    /** The mock backend's `{ authUrl, state, grant }` from a plan and the drawn state bytes. */
    oauthAuthorizeMockBuild(planJson: string, stateBase64: string): string;
    /** The failure payload `{ error, code, reason }` of a closed reason. */
    oauthFailure(reason: string): string;
}
/** The `@almadar/kernel` module-level exports the `http` effect uses; each takes and returns JSON text. */
interface HttpKernel extends Partial<OAuthAuthorizeKernel> {
    httpDriverStart(callJson: string, egressJson: string): string;
    httpDriverResume(driverJson: string, answerJson: string): string;
    isPublicAddress(ip: string): boolean;
    /** Frames a chunk of a stream (`{ events, carry }`); each event carries `key`. The call's driver is not needed. */
    frameStream(framing: StreamFramingWire, key: string | null, chunk: string, carry: string): string;
    /** The events the unterminated tail in `carry` makes at end of body. */
    frameStreamFinish(framing: StreamFramingWire, key: string | null, carry: string): string;
    /** Releases what the kernel holds for a call that ends before its final step (cancelled, aborted, thrown). */
    httpDriverDrop(driverJson: string): void;
}
type StreamFramingWire = Extract<IoRequestWire, {
    kind: 'httpStream';
}>['framing'];
/** How a stream's body is framed, and the key each framed event echoes. */
interface StreamFrame {
    framing: StreamFramingWire;
    key: string | null;
}
/**
 * The host's secret store: a credential NAME in, its value out; `set` keeps a minted value (an OAuth2 token) for `ttlMs`.
 * `principal` is the signed-in user's id for a user-scoped credential (the kernel sets it from the dispatch's `@user`,
 * never the program); absent, the credential is app-wide.
 */
interface HttpSecrets {
    get(name: string, principal?: string): Promise<string | undefined>;
    /** `ttlMs` of 0 forgets the value. */
    set(name: string, value: string, ttlMs: number, principal?: string): Promise<void>;
    /** Replace the stored credential with `value`, durably (a rotated refresh token). A host without one cannot rotate. */
    rotate?(name: string, value: string, principal?: string): Promise<void>;
    /** Drop the credential, the minted value and the stored one. */
    forget(name: string, principal?: string): Promise<void>;
    /** Keep `value` as the credential until it is forgotten, creating it when absent (an OAuth connection's tokens): unlike `rotate` it needs no existing entry. `label` is a non-secret account name stored beside it, never the value. */
    persist?(name: string, value: string, principal?: string, label?: string): Promise<void>;
    /** The non-secret account label stored beside the credential; absent when its row carries none. */
    label?(name: string, principal?: string): Promise<string | undefined>;
    /** Keep a one-use value (a pending OAuth grant) where every instance of the deployment can take it: the credential store's adapter when it shares one-use values, else the minted tier. */
    hold?(name: string, value: string, ttlMs: number, principal?: string): Promise<void>;
    /** Remove and return a held or minted value in one step, the single read of a one-use value. */
    take?(name: string, principal?: string): Promise<string | undefined>;
    /** Whether `persist` keeps a value on this host. */
    durable?(): Promise<boolean>;
}
/** The credential-store key of one user's credential. */
declare function userCredentialKey(principal: string, name: string): string;
/** Where a host name points: its addresses, and whether the name already is one. */
interface ResolvedHost {
    literal: boolean;
    addresses: readonly string[];
}
interface PinnedInit {
    method: string;
    headers: Array<[string, string]>;
    body?: Uint8Array<ArrayBuffer>;
    redirect: 'manual';
    signal?: AbortSignal;
}
/** The part of a fetch response the exchange reads. */
interface PinnedResponse {
    status: number;
    headers: {
        entries(): IterableIterator<[string, string]>;
    };
    body: {
        getReader(): {
            read(): Promise<{
                done: boolean;
                value?: Uint8Array;
            }>;
            cancel?(): Promise<void>;
            releaseLock?(): void;
        };
    } | null;
    arrayBuffer(): Promise<ArrayBuffer>;
}
/** Fetch with the connection pinned to `address`, the one that was checked (no resolve-then-connect race). */
type PinnedFetch = (url: URL, init: PinnedInit, address: string) => Promise<PinnedResponse>;
/** CSPRNG output: `bytes` random bytes. */
type RandomSource = (bytes: number) => Uint8Array;
/**
 * The host's raw credential store and mode flag, answered to the kernel's `credentialStore*` and `credentialMode*`
 * asks. It decides nothing: the role gate, the declared-name check, the masking and the mode check are the kernel's.
 */
interface CredentialAdminPort {
    /** Whether the store can encrypt and the service and name of every stored row; `null` when the host holds no store. */
    list(): Promise<{
        enabled: boolean;
        entries: Array<{
            service: string;
            name: string;
        }>;
    } | null>;
    /** The stored value of credential `name`, from the store only. */
    read(name: string): Promise<string | null>;
    write(service: string, name: string, value: string): Promise<void>;
    /** Whether a stored row existed. */
    remove(name: string): Promise<boolean>;
    rotate(): Promise<{
        rotated: number;
        alreadyCurrent: number;
        unreadable: number;
    }>;
    /** The mode flag; `null` when the host keeps none. */
    mode(): Promise<string | null>;
    /** Switch the flag; the host may refuse. The mode in force afterwards. */
    setMode(mode: string): Promise<string>;
}
interface HttpPorts {
    kernel: () => Promise<HttpKernel>;
    /** The host CSPRNG `random-bytes` and the driver's `Random` ask draw from. */
    random: RandomSource;
    /** The program's declared `egress` origins. */
    egress: readonly string[];
    secrets: HttpSecrets;
    /** The credential store and mode flag the credential administration effects ask; absent, those asks fail unavailable. */
    credentials?: CredentialAdminPort;
    fetch: PinnedFetch;
    /** Looks a host up for the public-address check; `null` where the host cannot resolve a name (a browser). */
    resolve: ((host: string) => Promise<ResolvedHost>) | null;
    /** The host's beacon queue and keepalive fetch; absent, a `browser/beacon` call fails `unavailable`. */
    beacon?: BeaconDeliveryPorts;
    /** What an `oauth-client` call and the OAuth effects persist; absent, they fail `store-unavailable`. */
    oauth?: OAuthPort;
}
interface HttpPortsOptions {
    kernel: () => Promise<HttpKernel>;
    random?: RandomSource;
    egress: readonly string[];
    secrets?: HttpSecrets;
    /** Defaults to the installed credential store and mode flag. */
    credentials?: CredentialAdminPort;
    fetch?: PinnedFetch;
    resolve?: (host: string) => Promise<ResolvedHost>;
    /** What `oauth-client` calls and the OAuth effects persist; absent, they fail `store-unavailable`. */
    oauth?: OAuthPort;
}
interface BrowserHttpPortsOptions {
    kernel: () => Promise<HttpKernel>;
    /** The program's declared `egress` origins. */
    egress: readonly string[];
    /** Defaults to the global `fetch`. */
    fetch?: (url: string, init: RequestInit) => Promise<PinnedResponse & Response>;
    /** Defaults to `navigator.sendBeacon` (text/plain Blob) when the page has one, and the global `fetch`. */
    beacon?: BeaconDeliveryPorts;
}
/**
 * What an OAuth flow asks its host to keep (pending grants, connections, the subject index, discovered metadata,
 * the clock). `principal` is the dispatch's signed-in user, set by the kernel and never by the program.
 */
interface OAuthPort {
    answer(ask: OAuthAsk, principal: string | undefined): Promise<OAuthReply>;
}
/** The loud, coded error for a host that gave the `http` effect no ports. */
declare class HttpUnavailableError extends Error {
    readonly code = "HTTP_KERNEL_UNAVAILABLE";
    constructor(detail: string);
}
/** A failed `http` effect: its payload is what the `emit.failure` route carries. */
declare class HttpEffectFailure extends Error {
    readonly payload: HttpFailurePayload;
    constructor(payload: HttpFailurePayload);
}
/** Where the secrets' durable credentials live: the store a host installed, and how a name resolves through it. */
interface HttpSecretsHost {
    store(): Promise<CredentialStore | null>;
    resolve(name: string, principal: string | undefined): Promise<string | undefined>;
}
/** In-process secrets: minted values with an expiry, then the credential store the host holds (by default the one the host installed). */
declare function createHttpSecrets(now?: () => number, host?: HttpSecretsHost): HttpSecrets;
/** The credential store and mode flag the host installed, as the kernel's raw asks. */
declare function createCredentialAdminPort(): CredentialAdminPort;
/** Bytes from the platform CSPRNG. */
declare const systemRandom: RandomSource;
/** The most bytes one `random-bytes` may ask for (the kernel's `RANDOM_BYTES_MAX`). */
declare const RANDOM_BYTES_MAX = 1024;
/** Standard padded base64 (the wire form of a `Random` answer). */
declare function base64Standard(bytes: Uint8Array): string;
/** URL-safe base64 without padding (the `random-bytes` value; the kernel's `codec::base64url_encode`). */
declare function base64Url(bytes: Uint8Array): string;
/**
 * `random-bytes`: the success payload for `bytes` drawn from the host CSPRNG; a bad count or key is the effect's
 * failure. A keyed call echoes its `key` beside the `value`.
 */
declare function randomBytesPayload(ports: Pick<HttpPorts, 'random'>, bytes: RuntimeValue | undefined, key?: RuntimeValue): {
    value: string;
    key?: string;
};
/** `credential-status`: a bare name selects the viewer; an explicit slot selects its declared scope. */
declare function credentialStatusPayload(ports: Pick<HttpPorts, 'secrets'>, credential: RuntimeValue | undefined, principal: string | undefined): Promise<CredentialPayload>;
/** `credential-forget`: drops the signed-in viewer's credential; `{ connected: false }`. */
declare function credentialForgetPayload(ports: Pick<HttpPorts, 'secrets'>, credential: RuntimeValue | undefined, principal: string | undefined): Promise<{
    connected: false;
    label: string;
}>;
/** The Node half of the server `http` ports: name resolution and the address-pinned fetch (`@almadar/shell-node` installs it). */
interface NetPort {
    resolve: (host: string) => Promise<ResolvedHost>;
    fetch: PinnedFetch;
}
declare function installNetPort(port: NetPort): void;
declare function createHttpPorts(options: HttpPortsOptions): HttpPorts;
/**
 * Ports for a client-site `http` (a call with no `auth`): the same kernel driver and exchange as the server,
 * over the browser's `fetch`. A browser cannot resolve a name or pin a connection, so there is no
 * public-address check; the program's `egress` (the driver refuses any other origin) and the browser's own
 * CORS rules bound what the call reaches.
 */
declare function createBrowserHttpPorts(options: BrowserHttpPortsOptions): HttpPorts;
/** What one exchange came to; a cancelled exchange is the caller's abort signal, never an outcome. */
type Exchange = {
    kind: 'reply';
    response: HttpResponseWire;
} | {
    kind: 'failure';
    failure: HttpFailureWire;
};
/** Send one built request after its requested retry delay and read the whole reply. */
declare function sendHttp(ports: HttpPorts, request: HttpRequestWire, signal?: AbortSignal, delayMs?: number): Promise<Exchange>;
/**
 * Send one built request and hand each framed event of the body to `onEvent` as it arrives; the reply that
 * ends the exchange carries an empty body. Framing, and the `key` each event echoes, are the kernel's
 * (`frameStream`, `frameStreamFinish`) over the ask's `framing` and `key`.
 */
declare function streamHttp(ports: HttpPorts, request: HttpRequestWire, stream: StreamFrame, onEvent: (event: HttpStreamEvent) => void, signal?: AbortSignal): Promise<Exchange>;
/** How a host took one beacon, as the driver's `beacon` answer carries it; a fetch that threw is a failure. */
type BeaconSettled = {
    ok: {
        via: 'queue';
    } | {
        via: 'fetch';
        status: number;
    } | {
        via: 'unavailable';
        message: string;
    };
} | {
    error: {
        kind: 'failed';
        message: string;
    };
};
/**
 * Hand one built beacon request to the host's beacon port. Cancelling stops the wait only: the queue and the
 * fetch the browser already has are never aborted, and a late completion is dropped.
 */
declare function sendBeaconRequest(ports: HttpPorts, request: HttpRequestWire, signal?: AbortSignal): Promise<BeaconSettled>;

type HttpOutcome = {
    ok: JsonValue;
} | {
    error: HttpFailurePayload;
};
interface HttpRunOptions {
    signal?: AbortSignal;
    /** The dispatch's signed-in user id: whose credential a `scope: "user"` ask names (never set by the program). */
    principal?: string | undefined;
    /** Receives each framed event of a `stream` call. */
    onMessage?: (event: HttpStreamEvent) => void;
}

declare function isOAuthCode(value: JsonValue | undefined): value is HttpOAuthFailureCode;
declare function isOAuthReason(value: JsonValue | undefined): value is HttpOAuthFailureReason;
/** The failure of a call whose host has no port for what it needs. */
declare function unavailableFailure(error: string, key: string | null): HttpFailurePayload;
/** The reply the port answered, checked to be one of the closed reply variants. */
declare function checkOAuthReply(reply: OAuthReply): OAuthReply;
/**
 * One `http` effect, driven by the kernel's step machine (`httpDriverStart`/`httpDriverResume`): every ask
 * (credential, token store, request, stream) is answered here and nothing else is decided in TypeScript.
 */
declare function runHttpCall(ports: HttpPorts, call: HttpCall, options?: HttpRunOptions): Promise<HttpOutcome>;

export { type BeaconSettled, type BrowserHttpPortsOptions, type CredentialAdminPort, type Exchange, HttpEffectFailure, type HttpKernel, type HttpOutcome, type HttpPorts, type HttpPortsOptions, type HttpRunOptions, type HttpSecrets, type HttpSecretsHost, HttpUnavailableError, type NetPort, type OAuthAuthorizeKernel, type OAuthPort, type PinnedFetch, type PinnedInit, type PinnedResponse, RANDOM_BYTES_MAX, type RandomSource, type ResolvedHost, type StreamFrame, type StreamFramingWire, base64Standard, base64Url, checkOAuthReply, createBrowserHttpPorts, createCredentialAdminPort, createHttpPorts, createHttpSecrets, credentialForgetPayload, credentialStatusPayload, installNetPort, isOAuthCode, isOAuthReason, randomBytesPayload, runHttpCall, sendBeaconRequest, sendHttp, streamHttp, systemRandom, unavailableFailure, userCredentialKey };
