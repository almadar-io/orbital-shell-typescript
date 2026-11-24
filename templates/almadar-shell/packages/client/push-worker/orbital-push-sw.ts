/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

interface PushMessage {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

function readMessage(event: PushEvent): PushMessage | undefined {
  if (event.data === null) return undefined;
  const parsed: Partial<PushMessage> = event.data.json();
  if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string') return undefined;
  return { title: parsed.title, body: parsed.body, ...(typeof parsed.url === 'string' ? { url: parsed.url } : {}), ...(typeof parsed.icon === 'string' ? { icon: parsed.icon } : {}) };
}

self.addEventListener('push', (event) => {
  const message = readMessage(event);
  if (message === undefined) return;
  event.waitUntil(self.registration.showNotification(message.title, { body: message.body, data: { url: message.url ?? '/' }, ...(message.icon !== undefined ? { icon: message.icon } : {}) }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: { url?: string } = event.notification.data;
  const target = new URL(typeof data.url === 'string' ? data.url : '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === target);
      return open !== undefined ? open.focus() : self.clients.openWindow(target);
    }),
  );
});

export {};
