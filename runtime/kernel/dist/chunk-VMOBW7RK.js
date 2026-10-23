// src/kernel/beacon.ts
async function deliverBeacon(url, text, ports) {
  try {
    if (ports.queue !== void 0 && ports.queue(url, text)) return { via: "queue" };
  } catch {
  }
  try {
    const { status } = await ports.fetch(url, {
      method: "POST",
      body: text,
      keepalive: true,
      mode: "cors",
      headers: { "Content-Type": "text/plain" }
    });
    return { via: "fetch", status };
  } catch {
    return { via: "fetch", status: null };
  }
}

export { deliverBeacon };
