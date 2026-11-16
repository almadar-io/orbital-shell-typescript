import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserKernel } from '../src/kernel-loader.js';

function glue(log: string[], name = 'main') {
  return { name, installLanguage: (bundle: string): void => { log.push(`install ${name} ${bundle}`); } };
}

const compiled = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));

function stubWasm(log: string[], language = '{"bundle":1}') {
  vi.stubGlobal('fetch', async (url: string) => {
    log.push(`fetch ${url}`);
    return new Response(url.endsWith('.wasm') ? 'wasm-bytes' : language);
  });
  vi.spyOn(WebAssembly, 'compile').mockImplementation(async () => {
    log.push('compile');
    return compiled;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadBrowserKernel', () => {
  it('compiles the wasm once, starts the module from it, then installs the language fetched from its own location', async () => {
    const log: string[] = [];
    stubWasm(log);
    const kernel = glue(log);
    const loaded = await loadBrowserKernel({
      init: async (input) => { log.push(`init ${input.module_or_path === compiled ? 'compiled' : 'other'}`); },
      glue: kernel,
      createInstance: () => glue(log, 'unused'),
      wasm: '/kernel.wasm',
      language: '/language.json',
    });
    expect(loaded.name).toBe('main');
    expect(log).toEqual(['fetch /kernel.wasm', 'fetch /language.json', 'compile', 'init compiled', 'install main {"bundle":1}']);
  });

  it('isolate makes a new instance from the same compiled module and language, without fetching or compiling again', async () => {
    const log: string[] = [];
    stubWasm(log, '{"bundle":2}');
    const made: Array<{ module: WebAssembly.Module; language: string }> = [];
    const loaded = await loadBrowserKernel({
      init: async () => undefined,
      glue: glue(log),
      createInstance: (module, language) => {
        made.push({ module, language });
        return glue(log, `instance-${made.length}`);
      },
      wasm: '/kernel.wasm',
      language: '/language.json',
    });
    log.length = 0;
    const first = loaded.isolate();
    const second = first.isolate();
    expect([first.name, second.name]).toEqual(['instance-1', 'instance-2']);
    expect(made).toEqual([{ module: compiled, language: '{"bundle":2}' }, { module: compiled, language: '{"bundle":2}' }]);
    expect(log).toEqual([]);
  });

  it('edge: a wasm that fails to compile fails the load and installs nothing', async () => {
    const log: string[] = [];
    stubWasm(log);
    vi.spyOn(WebAssembly, 'compile').mockRejectedValue(new Error('bad wasm'));
    await expect(loadBrowserKernel({ init: async () => undefined, glue: glue(log), createInstance: () => glue(log), wasm: '/k.wasm', language: '/language.json' }))
      .rejects.toThrow('bad wasm');
    expect(log.filter((l) => l.startsWith('install'))).toEqual([]);
  });

  it('edge: a wasm or language that cannot be fetched fails the load, naming it, and installs nothing', async () => {
    const log: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('.json') ? new Response('missing', { status: 404, statusText: 'Not Found' }) : new Response('wasm')));
    vi.spyOn(WebAssembly, 'compile').mockResolvedValue(compiled);
    await expect(loadBrowserKernel({ init: async () => undefined, glue: glue(log), createInstance: () => glue(log), wasm: '/k.wasm', language: '/language.json' }))
      .rejects.toThrow('/language.json: 404 Not Found');
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('.wasm') ? new Response('missing', { status: 404, statusText: 'Not Found' }) : new Response('{}')));
    await expect(loadBrowserKernel({ init: async () => undefined, glue: glue(log), createInstance: () => glue(log), wasm: '/k.wasm', language: '/language.json' }))
      .rejects.toThrow('/k.wasm: 404 Not Found');
    expect(log).toEqual([]);
  });
});
