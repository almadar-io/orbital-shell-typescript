import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserKernel } from '../src/kernel-loader.js';

function glue(log: string[]) {
  return { installLanguage: (bundle: string): void => { log.push(`install ${bundle}`); } };
}

afterEach(() => vi.unstubAllGlobals());

describe('loadBrowserKernel', () => {
  it('instantiates the wasm from its location, then installs the language fetched from its own', async () => {
    const log: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      log.push(`fetch ${url}`);
      return new Response('{"bundle":1}');
    });
    const kernel = glue(log);
    const loaded = await loadBrowserKernel({
      init: async (input) => { log.push(`init ${input.module_or_path}`); },
      glue: kernel,
      wasm: '/kernel.wasm',
      language: '/language.json',
    });
    expect(loaded).toBe(kernel);
    expect(log).toEqual(['init /kernel.wasm', 'fetch /language.json', 'install {"bundle":1}']);
  });

  it('edge: a language that cannot be fetched fails the load, naming it, and installs nothing', async () => {
    const log: string[] = [];
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404, statusText: 'Not Found' }));
    await expect(loadBrowserKernel({ init: async () => undefined, glue: glue(log), wasm: '/k.wasm', language: '/language.json' }))
      .rejects.toThrow('/language.json: 404 Not Found');
    expect(log).toEqual([]);
  });
});
