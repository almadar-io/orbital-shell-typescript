/**
 * Hono Application Setup
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import {
  errorHandler,
  notFoundHandler,
  debugEventsRouter,
  personasRouter,
  pushRouter,
  pushServiceWorkerHandler,
  PUSH_SERVICE_WORKER_PATH,
  reportsRouter,
  createHooksRouter,
  type AppEnv,
} from '@almadar/server-hono';
import { deliverInbound } from './inbound.js';
import { registerRoutes } from './routes.js';
import { identityRoster } from './viewer.js';

export const app = new Hono<AppEnv>();

// Middleware
app.use('*', cors({ origin: (origin) => origin, credentials: true }));
// gzip for responses of 1 KB and more; hono/compress leaves text/event-stream uncompressed.
app.use('*', compress());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Debug event bus endpoints (dev-only, no-op in production)
app.route('/api/debug', debugEventsRouter());

// Web Push surface (browser/push-subscribe): public VAPID key + the shared
// service worker (root-scoped — a SW's max scope is its own directory).
app.route('/api/push', pushRouter);
app.get(PUSH_SERVICE_WORKER_PATH, pushServiceWorkerHandler);

// Inbound webhook ingress: mounted BEFORE the authenticated /api routes — hook senders (Google
// Calendar watch channels, e-sign status, banking callbacks) cannot present a Firebase token. The
// route knows no provider: it carries `{ name, headers, rawBody }` to the generated `inbound.ts`
// and writes back the answer; the handler trait's own transitions verify the sender (EXEC-INBOUND-1).
app.route('/api/hooks', createHooksRouter({ deliver: deliverInbound }));

// Register generated routes
// Dev personas: the [identity] rows as Auth-emulator users (mounted only while
// FIREBASE_AUTH_EMULATOR_HOST is set). Signing in as one yields a real ID token.
app.route('/api', personasRouter(identityRoster));

registerRoutes(app);

// Server-side report export (Excel/PDF/CSV). Mounted AFTER registerRoutes so
// the /api/* auth middleware it registers covers this route too.
app.route('/api/reports', reportsRouter);

// Error handling
app.notFound(notFoundHandler);
app.onError(errorHandler);
