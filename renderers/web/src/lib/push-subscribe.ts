import { isJsonObject, type JsonValue } from '@almadar/core';
import { HostAskError, type HostPushSubscription } from '@almadar/shell-runtime/kernel/host';

/** The push service worker the client build ships at its root, so it can take the whole site as scope. */
export const PUSH_WORKER_URL = '/orbital-push-sw.js';

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The host serves the key at its origin's root, also when the app's API sits under a path (a central host's /apps/<app>). */
async function vapidPublicKey(apiBase: string): Promise<string> {
  const origin = apiBase === '' ? window.location.origin : new URL(apiBase, window.location.origin).origin;
  const response = await fetch(`${origin}/api/push/vapid-public-key`);
  if (!response.ok) throw new HostAskError('unavailable', `the server has no VAPID key (${response.status})`);
  const body: JsonValue = await response.json();
  const key = isJsonObject(body) ? body['publicKey'] : undefined;
  if (typeof key !== 'string' || key === '') throw new HostAskError('unavailable', 'the server answered no VAPID public key');
  return key;
}

/** `browser/push-subscribe` on the web: asks for notification permission, registers the push worker, and subscribes through PushManager with the server's VAPID key. */
export function webPushSubscribe(apiBase: string): () => Promise<HostPushSubscription> {
  return async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof PushManager === 'undefined' || typeof Notification === 'undefined') {
      throw new HostAskError('unavailable', 'this browser has no Push API');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new HostAskError('denied', 'notifications are not allowed for this site');
    await navigator.serviceWorker.register(PUSH_WORKER_URL, { scope: '/' });
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(await vapidPublicKey(apiBase)) }));
    const p256dh = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');
    if (p256dh === null || auth === null) throw new HostAskError('unavailable', 'the push subscription carries no keys');
    return { kind: 'webpush', endpoint: subscription.endpoint, p256dh: bytesToBase64Url(p256dh), auth: bytesToBase64Url(auth) };
  };
}
