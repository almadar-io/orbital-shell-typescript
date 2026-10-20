/**
 * Express Application Setup
 */

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
  env,
  logger,
  errorHandler,
  notFoundHandler,
  debugEventsRouter,
  pushRouter,
  pushServiceWorkerHandler,
  PUSH_SERVICE_WORKER_PATH,
  reportsRouter,
  createHooksRouter,
  captureRawBody,
  compressionMiddleware,
} from '@almadar/server';
import { deliverInbound } from './inbound.js';
import { registerRoutes } from './routes.js';

export const app: Express = express();

// Middleware
app.use(helmet());
// brotli/gzip for responses of 1 KB and more; the SSE event stream is left uncompressed.
app.use(compressionMiddleware());
// CORS: env-driven allowlist (CORS_ORIGIN) — never reflect arbitrary origins with credentials.
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '16mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }));
// Rate limiting protects deployed apps; verification walkers and local dev
// fire hundreds of bridge events per minute and must not be throttled —
// ORB_DISABLE_RATE_LIMIT=1 (set by the verify harness) bypasses it.
if (process.env.ORB_DISABLE_RATE_LIMIT !== '1') {
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Debug event bus endpoints (dev-only, no-op in production)
app.use('/api/debug', debugEventsRouter());

// Web Push surface (browser/push-subscribe): public VAPID key + the shared
// service worker (root-scoped — a SW's max scope is its own directory).
app.use('/api/push', pushRouter);
app.get(PUSH_SERVICE_WORKER_PATH, pushServiceWorkerHandler);

// Inbound webhook ingress: mounted BEFORE the authenticated /api routes — hook senders (Google
// Calendar watch channels, e-sign status, banking callbacks) cannot present a Firebase token. The
// route knows no provider: it carries `{ name, headers, rawBody }` to the generated `inbound.ts`
// and writes back the answer; the handler trait's own transitions verify the sender (EXEC-INBOUND-1).
// The dev personas are hooks too (`personas`, `persona-sign-in`, from std-dev-personas).
app.use('/api/hooks', createHooksRouter({ deliver: deliverInbound }));

// Register generated routes
registerRoutes(app);

// Server-side report export (Excel/PDF/CSV). Mounted AFTER registerRoutes so
// the /api auth middleware it registers covers this route too.
app.use('/api/reports', reportsRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);
