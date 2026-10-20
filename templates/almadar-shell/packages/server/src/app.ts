/**
 * The app's HTTP host: the transport policy (security headers, compression, CORS, the API rate limit) and the listener.
 * Every API request goes to the native server's router as received; the live stream's connections are held here and
 * fed by the kernel's routing rule.
 */

import compression from 'compression';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { openKernel } from './kernel.js';
import { deliver, openStream } from './live.js';

export const app: Express = express();

const server = openKernel((itemJson) => deliver(server, itemJson));

const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim()).filter((o) => o.length > 0);
const UNFORWARDED = new Set(['content-length', 'transfer-encoding', 'connection']);

app.use('/api', helmet());
app.use(compression({ threshold: 1024, filter: (req, res) => !String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream') && compression.filter(req, res) }));
app.use(cors({ origin: origins, credentials: true }));
if (process.env.ORB_DISABLE_RATE_LIMIT !== '1') {
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/events', (req, res) => {
  const viewer = typeof req.query.ticket === 'string' ? server.takeTicket(req.query.ticket) : null;
  if (viewer === null) {
    res.status(401).json({ error: 'A valid stream ticket is required', code: 'UNAUTHORIZED' });
    return;
  }
  openStream(res, typeof req.query.clientId === 'string' ? req.query.clientId : null, JSON.parse(viewer));
});

app.use('/api', express.raw({ type: () => true, limit: '16mb' }), (req: Request, res: Response) => {
  const headers = Object.entries(req.headers).flatMap(([name, value]) => (Array.isArray(value) ? value.map((v) => [name, v]) : value === undefined ? [] : [[name, value]]));
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const answer = server.handle(req.method, req.originalUrl, JSON.stringify(headers), body);
  const answered: Array<[string, string]> = JSON.parse(answer.headersJson);
  res.status(answer.status);
  for (const [name, value] of answered) if (!UNFORWARDED.has(name.toLowerCase())) res.setHeader(name, value);
  res.send(answer.body);
});
