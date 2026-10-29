import type { HostAudioAsk, KernelHostActions } from '@almadar/shell-runtime/kernel/host';

let audioHost: ((ask: HostAudioAsk) => void) | undefined;
let signOutHost: (() => void | Promise<void>) | undefined;

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

/** What the web shell answers `audio/*` and `auth/sign-out` with: the host installed above, read per ask. */
export const webHostActions: KernelHostActions = {
  get audio() {
    return audioHost;
  },
  get signOut() {
    return signOutHost;
  },
};
