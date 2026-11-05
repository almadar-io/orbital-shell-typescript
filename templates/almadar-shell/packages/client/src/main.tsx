/**
 * Entry point (kernel host): reads the program's `ClientManifest` (`client.json`), links the program's
 * `themes.css`, then renders the App, which loads the locale catalog each route names; a prerendered
 * page stays on screen until the live page has rendered. A missing
 * manifest stops the boot with the reason: a client without its program has nothing to show.
 *
 * @packageDocumentation
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { parseClientManifest, type JsonValue } from '@almadar/core';
import { App } from './App';
import './index.css';

async function fetchJson(file: string): Promise<JsonValue> {
  const response = await fetch(`${import.meta.env.BASE_URL}${file}`);
  if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`);
  const body: JsonValue = await response.json();
  return body;
}

async function boot(): Promise<void> {
  const manifest = parseClientManifest(await fetchJson('client.json'));
  const themes = document.createElement('link');
  themes.rel = 'stylesheet';
  themes.href = `${import.meta.env.BASE_URL}themes.css`;
  document.head.append(themes);
  mount(<App manifest={manifest} />);
}

/** The live tree is shown once its main slot has content and nothing is loading: the mark `prerender.mjs` waits for. */
function settled(container: HTMLElement): boolean {
  return container.querySelector('[data-slot-mode="content"]') !== null && container.querySelector('[data-loading-state]') === null;
}

/**
 * A prerendered page stays on screen while the kernel boots: the live tree renders hidden beside it and replaces it
 * once settled. An empty `#root` (a page that was not prerendered) mounts directly.
 */
function mount(app: React.ReactElement): void {
  const root = document.getElementById('root')!;
  if (root.childElementCount === 0) {
    ReactDOM.createRoot(root).render(app);
    return;
  }
  const live = document.createElement('div');
  live.style.cssText = 'position:absolute;top:0;left:0;right:0;visibility:hidden';
  root.after(live);
  const observer = new MutationObserver(() => {
    if (!settled(live)) return;
    observer.disconnect();
    root.remove();
    live.removeAttribute('style');
    live.id = 'root';
  });
  observer.observe(live, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-loading-state', 'data-slot-mode'] });
  ReactDOM.createRoot(live).render(app);
}

void boot();
