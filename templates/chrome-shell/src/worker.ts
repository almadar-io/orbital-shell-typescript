/**
 * The extension's service worker hosts the program on the wasm kernel: the kernel decides every step and
 * the worker answers its raw asks — browser-stored entities in IndexedDB, every `browser/tab-*` by the Chrome tabs, declared inputs (a watched
 * page's elements) dispatched by the host.
 * At start it mounts the program's `/` page, as a view would, so its traits run with no view open;
 * the side panel connects over a port and renders the same running program.
 */
import { getTraitName, parseOrbitalSchema } from '@almadar/core';
import { holdUntilServed, serveChannel } from '@almadar/shell-web';
import { browserStoreName, openBrowserHost, type BrowserHost } from '@almadar/shell-web';
import { chromePromptModel, chromeTabPort, type ChromeLanguageModel } from '@almadar/shell-chrome';
import programText from './generated/program.orb?raw';
import { portChannel, VIEW_PORT } from './channel';
import { embedder } from './generated/embedder';
import { secretPorts } from './generated/secret-ports';
import { kernelReady } from './generated/kernel';

declare const LanguageModel: ChromeLanguageModel | undefined;

const promptModel = chromePromptModel(() => (typeof LanguageModel === 'undefined' ? undefined : LanguageModel));

const schema = parseOrbitalSchema(JSON.parse(programText));

// The tab port listens for its content scripts now: Chrome wakes a stopped worker only for listeners added in its first turn.
let loadedKernel: Awaited<typeof kernelReady> | undefined;
const tabs = chromeTabPort(chrome.tabs, chrome.runtime, (pattern, url) => {
  if (loadedKernel === undefined) throw new Error('A tab was matched before the kernel loaded');
  return loadedKernel.tabUrlMatches(pattern, url);
});

const hostReady: Promise<BrowserHost> = kernelReady.then((kernel) => {
  loadedKernel = kernel;
  return openBrowserHost({
    databaseName: browserStoreName(schema.name, undefined),
    schema,
    kernel,
    tabs,
    ...(secretPorts !== undefined ? { secretPorts } : {}),
    onDevice: { model: promptModel, ...(embedder !== undefined ? { embedder } : {}) },
  });
});

async function mountRootPage(host: BrowserHost): Promise<void> {
  const seeds = host.routeMounts('/');
  for (const orbital of schema.orbitals) {
    const owned = new Set((orbital.traits ?? []).map(getTraitName));
    const mount = seeds.filter((seed) => owned.has(seed.trait));
    const first = mount[0];
    if (first !== undefined) await host.send(orbital.name, { event: first.event, mount, payload: {} });
  }
}

void hostReady.then(mountRootPage);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== VIEW_PORT) return;
  // A view can connect while the worker is still starting; its first messages wait for the host.
  const channel = holdUntilServed(portChannel(port));
  void hostReady.then((host) => {
    const served = serveChannel(channel, host, { schemaName: schema.name });
    // What the worker runs on its own (a watched page's elements) shows in the open panel.
    const stopReporting = host.onInputDispatched((orbital, request, response) => served.pushDispatch(orbital, request, response));
    port.onDisconnect.addListener(() => {
      stopReporting();
      served.stop();
    });
  });
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
