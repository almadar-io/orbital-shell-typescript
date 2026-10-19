/**
 * Entry point (kernel host): reads the program's `ClientManifest` (`client.json`) and its locale
 * messages, links the program's `themes.css`, then renders the App. Any of them missing stops the
 * boot with the reason: a client without its program has nothing to show.
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

function messagesOf(catalog: JsonValue): Record<string, string> {
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('locale messages: not an object');
  const messages: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (!key.startsWith('$') && typeof value === 'string') messages[key] = value;
  }
  return messages;
}

async function boot(): Promise<void> {
  const manifest = parseClientManifest(await fetchJson('client.json'));
  const messages = messagesOf(await fetchJson(`locales/${manifest.locale}.json`));
  const themes = document.createElement('link');
  themes.rel = 'stylesheet';
  themes.href = `${import.meta.env.BASE_URL}themes.css`;
  document.head.append(themes);
  ReactDOM.createRoot(document.getElementById('root')!).render(<App manifest={manifest} messages={messages} />);
}

void boot();
