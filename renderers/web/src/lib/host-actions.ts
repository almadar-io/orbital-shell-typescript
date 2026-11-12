import { isJsonObject, type EventPayload, type HostAskCompletion, type JsonObject, type JsonValue } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { hostAskReturn, performHostAnswer, type HostAudioAsk, type HostConsentAnswer, type HostConsentRequest, type HostSignInAnswer, type HostSignInRequest, type KernelHostActions } from '@almadar/shell-runtime/kernel/host';

import { readAudioClock, scheduleAudio } from '../providers/audio-scheduler';
import { browserConsentEnv, consentByPopup } from './consent-popup';

const log = createLogger('almadar:ui:host-actions');

let audioHost: ((ask: HostAudioAsk) => void) | undefined;
let signOutHost: (() => void | Promise<void>) | undefined;
let signInHost: ((request: HostSignInRequest) => Promise<HostSignInAnswer>) | undefined;
let consentHost: ((request: HostConsentRequest) => Promise<HostConsentAnswer>) | undefined;

/** Install the audio the `audio/*` asks drive (the mounted game audio provider); the returned function removes it. */
export function registerHostAudio(host: (ask: HostAudioAsk) => void): () => void {
  audioHost = host;
  return () => {
    if (audioHost === host) audioHost = undefined;
  };
}

/** Install the sign-out `auth/sign-out` runs (the host's auth provider); the returned function removes it. */
export function registerHostSignOut(host: () => void | Promise<void>): () => void {
  signOutHost = host;
  return () => {
    if (signOutHost === host) signOutHost = undefined;
  };
}

/** Install the sign-in `auth/sign-in` runs (the host's auth provider); the returned function removes it. */
export function registerHostSignIn(host: (request: HostSignInRequest) => Promise<HostSignInAnswer>): () => void {
  signInHost = host;
  return () => {
    if (signInHost === host) signInHost = undefined;
  };
}

/** Install the consent `auth/consent` runs in place of the popup (a shell with its own authorize window, such as an extension); the returned function removes it. */
export function registerHostConsent(host: (request: HostConsentRequest) => Promise<HostConsentAnswer>): () => void {
  consentHost = host;
  return () => {
    if (consentHost === host) consentHost = undefined;
  };
}

/** What the web shell answers `audio/*` and `auth/sign-out` with: the host installed above, read per ask. */
export const webHostActions: KernelHostActions = {
  get audio() {
    return audioHost;
  },
  get signOut() {
    return signOutHost;
  },
  get signIn() {
    return signInHost;
  },
  audioSchedule: scheduleAudio,
  audioClock: readAudioClock,
  get consent() {
    return consentHost ?? (typeof window === 'undefined' ? undefined : consentByPopup(browserConsentEnv(window)));
  },
};

/** Dispatches one event to a trait: the return of a host ask. */
export type HostAskDispatch = (trait: string, event: string, payload: EventPayload) => Promise<void>;

/** A trace stream over the asking kernel's own steps (EXEC-DIST-14); the returned function ends it. */
export type HostTraceSource = (traits: readonly string[], onItem: (item: JsonObject) => void) => () => void;

/** The trace streams this host opened, by the key the asking trait gave them; `cancel-call` of a key ends its stream. */
const traceStreams = new Map<string, () => void>();

function streamTrace(args: readonly JsonValue[], completion: HostAskCompletion, dispatch: HostAskDispatch | undefined, source: HostTraceSource | undefined): void {
  const { key, onMessage, failure, trait } = completion;
  if (key === undefined || onMessage === undefined) return;
  const refuse = (error: string): void => {
    log.error('trace stream refused', { trait, key, error });
    if (failure !== undefined && dispatch !== undefined) void dispatch(trait, failure, { error, key, ...(completion.entityId !== undefined ? { entityId: completion.entityId } : {}) });
  };
  const options = args[0];
  const named = options !== undefined && options !== null && isJsonObject(options) ? options['traits'] : undefined;
  const traits = Array.isArray(named) ? named.flatMap((t) => (typeof t === 'string' ? [t] : [])) : [];
  if (traits.length === 0) return refuse('program/live trace: name the traits it observes in `traits`');
  if (source === undefined || dispatch === undefined) return refuse('program/live trace: this host has no kernel trace to stream');
  if (traceStreams.has(key)) return refuse(`key ${key} already has a stream open`);
  traceStreams.set(key, source(traits, (item) => {
    void dispatch(trait, onMessage, { ...item, key, ...(completion.entityId !== undefined ? { entityId: completion.entityId } : {}) }).catch((error: Error) => log.error('trace item return failed', { trait, key, error: error.message }));
  }));
}

function cancelStreams(args: readonly JsonValue[]): void {
  const named = args[0];
  const keys = typeof named === 'string' ? [named] : Array.isArray(named) ? named.flatMap((k) => (typeof k === 'string' ? [k] : [])) : [];
  for (const key of keys) {
    traceStreams.get(key)?.();
    traceStreams.delete(key);
  }
}

/**
 * Answers one `host-ask` client effect the kernel handed back (`auth/sign-out`, `auth/sign-in`, `auth/consent`, `audio/*`). An ask
 * that declared `emit` routes returns its answer by dispatching the route's event to the asking trait; a refusal of
 * an ask with no route is logged by name. A `program/live` trace ask streams the asking kernel's own steps to its
 * `onMessage` route until a host-asked `cancel-call` names its key (EXEC-DIST-14).
 */
export async function answerHostAsk(op: string, args: readonly JsonValue[], completion: HostAskCompletion | undefined, dispatch: HostAskDispatch | undefined, trace?: HostTraceSource): Promise<void> {
  if (op === 'cancel-call') return cancelStreams(args);
  if (op === 'program/live' && completion?.onMessage !== undefined) return streamTrace(args, completion, dispatch, trace);
  const outcome = await performHostAnswer(webHostActions, op, args);
  if ('error' in outcome) log.error('host-ask refused', { op, error: outcome.error, kind: outcome.kind });
  if (completion === undefined) return;
  const returned = hostAskReturn(completion, outcome);
  if (returned === undefined) return;
  if (dispatch === undefined) {
    log.error('host-ask has no dispatch to return its answer to', { op, trait: returned.trait, event: returned.event });
    return;
  }
  await dispatch(returned.trait, returned.event, returned.entityId !== undefined ? { ...returned.payload, entityId: returned.entityId } : returned.payload);
}
