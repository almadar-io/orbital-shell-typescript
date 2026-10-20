/**
 * The live channel (`GET /api/events?ticket=&clientId=`): one server-sent event stream per tab. The kernel decides which
 * connections receive each live item (`liveRecipients`: an origin item to the tab that asked, a peer item to every other
 * tab whose viewer may read its row); this module only holds the connections and writes the frames.
 */

import type { Response } from 'express';
import type { NativeServer } from './kernel.js';

interface Connection {
  clientId: string | null;
  viewer: object | null;
  res: Response;
}

interface LiveItem {
  event: string;
  payload?: object;
  source: object;
}

const connections = new Set<Connection>();

export function openStream(res: Response, clientId: string | null, viewer: object | null): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const connection: Connection = { clientId, viewer, res };
  connections.add(connection);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(keepAlive);
    connections.delete(connection);
  });
}

export function deliver(server: NativeServer, itemJson: string): void {
  const open = [...connections];
  if (open.length === 0) return;
  const indexes: number[] = JSON.parse(server.liveRecipients(itemJson, JSON.stringify(open.map(({ clientId, viewer }) => ({ clientId, viewer })))));
  const item: LiveItem = JSON.parse(itemJson);
  const frame = JSON.stringify({ type: 'bus', event: item.event, ...(item.payload !== undefined ? { payload: item.payload } : {}), source: item.source, timestamp: Date.now() });
  for (const at of indexes) open[at]?.res.write(`data: ${frame}\n\n`);
}
