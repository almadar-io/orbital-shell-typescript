/**
 * Entry point (kernel host): reads the program's `ClientManifest` (`client.json`), links the program's
 * `themes.css`, then renders the App, which loads the locale catalog each route names. A missing
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
  ReactDOM.createRoot(document.getElementById('root')!).render(<App manifest={manifest} />);
}

void boot();
