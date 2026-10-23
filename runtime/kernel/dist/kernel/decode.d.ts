import { HttpBody, HttpRequestWire, HttpResponseWire, OAuthAsk, ServerProgressWire, IoRequestWire, ResolveProgressWire } from '@almadar/core/kernel-wire';
import { JsonValue } from '@almadar/core';

/** Decoders for what the kernel hands back as JSON: narrowed by checks, never cast. */

declare function decodeHttpBody(value: JsonValue): HttpBody;
declare function decodeHttpRequest(value: JsonValue): HttpRequestWire;
declare function decodeHttpResponse(value: JsonValue): HttpResponseWire;
declare function decodeRequest(value: JsonValue): IoRequestWire;
declare function decodeProgress(json: string): ServerProgressWire;
declare function decodeResolveProgress(json: string): ResolveProgressWire;
/** The driver's `oauth` ask, decoded against the closed ask set before it reaches the host's store. */
declare function decodeOAuthAsk(value: JsonValue | undefined): OAuthAsk;

export { decodeHttpBody, decodeHttpRequest, decodeHttpResponse, decodeOAuthAsk, decodeProgress, decodeRequest, decodeResolveProgress };
