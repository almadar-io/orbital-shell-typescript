import { describe, it, expect } from 'vitest';
import { build } from 'tsup';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

type Calls = Record<'debug' | 'info' | 'warn' | 'error', number>;

interface LoggerModule {
  createLogger(namespace: string): { debug(m: string): void; info(m: string): void; warn(m: string): void };
}

async function browserBundle(define: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'logger-browser-'));
  try {
    await build({
      entry: { logger: join(__dirname, '../src/index.ts') },
      outDir: dir,
      format: ['iife'],
      globalName: 'AlmadarLogger',
      platform: 'browser',
      define,
      dts: false,
      silent: true,
      config: false,
      clean: false,
    });
    return readFileSync(join(dir, 'logger.global.js'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runWithoutProcess(code: string): Calls {
  const calls: Calls = { debug: 0, info: 0, warn: 0, error: 0 };
  const console = {
    debug: () => { calls.debug++; },
    info: () => { calls.info++; },
    warn: () => { calls.warn++; },
    error: () => { calls.error++; },
    log: () => {},
  };
  const context: { console: typeof console; globalThis?: unknown; AlmadarLogger?: LoggerModule } = { console };
  context.globalThis = context;
  runInNewContext(code, context);
  const log = context.AlmadarLogger!.createLogger('almadar:test:browser');
  log.debug('d');
  log.info('i');
  log.warn('w');
  return calls;
}

describe('a browser bundle reads the build-declared NODE_ENV', () => {
  it('a production build logs warnings but not debug or info', async () => {
    const calls = runWithoutProcess(await browserBundle({ 'process.env.NODE_ENV': '"production"' }));
    expect(calls).toEqual({ debug: 0, info: 0, warn: 1, error: 0 });
  }, 60_000);

  it('control: a development build logs debug', async () => {
    const calls = runWithoutProcess(await browserBundle({ 'process.env.NODE_ENV': '"development"' }));
    expect(calls.debug).toBe(1);
    expect(calls.warn).toBe(1);
  }, 60_000);
});
