import type { EventPayload, HostAskCompletion, JsonValue } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { hostAskReturn, performHostAnswer, type HostAudioAsk, type HostSignInAnswer, type HostSignInRequest, type KernelHostActions } from '@almadar/shell-runtime/kernel/host';

const log = createLogger('almadar:ui:host-actions');

let audioHost: ((ask: HostAudioAsk) => void) | undefined;
let signOutHost: (() => void | Promise<void>) | undefined;
let signInHost: ((request: HostSignInRequest) => Promise<HostSignInAnswer>) | undefined;

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
};

/** Dispatches one event to a trait: the return of a host ask. */
export type HostAskDispatch = (trait: string, event: string, payload: EventPayload) => Promise<void>;

/**
 * Answers one `host-ask` client effect the kernel handed back (`auth/sign-out`, `auth/sign-in`, `audio/*`). An ask
 * that declared `emit` routes returns its answer by dispatching the route's event to the asking trait; a refusal of
 * an ask with no route is logged by name.
 */
export async function answerHostAsk(op: string, args: readonly JsonValue[], completion: HostAskCompletion | undefined, dispatch: HostAskDispatch | undefined): Promise<void> {
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
