import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOrbitalSchema } from '@almadar/core';
import { createChannelTransport } from '@almadar/shell-web';
import { chromeConsent } from '@almadar/shell-chrome';
import { OrbPreview } from '@almadar/shell-web/runtime';
import programText from './generated/program.orb?raw';
import { KEEP_ALIVE, KEEP_ALIVE_MS, portChannel, VIEW_PORT } from './channel';
import './index.css';

const consentAsk = chromeConsent(() => chrome.identity);

// The view's own kernel (its circuit, and the canvases a scene draws on) loads on first use, not with the panel.
const loadPanelKernel = () => import('./generated/kernel').then(({ kernelReady }) => kernelReady);
const makeCanvas3D = (canvas: HTMLCanvasElement) => loadPanelKernel().then((kernel) => kernel.Canvas3D.create(canvas));
const makeSceneCanvas = (canvas: HTMLCanvasElement) => loadPanelKernel().then((kernel) => kernel.SceneCanvas.create(canvas));

const schema = parseOrbitalSchema(JSON.parse(programText));

// The worker runs the whole program, browser-stored entities included; the panel only shows it.
// If its port closes anyway (the worker stopped or updated), the panel connects again and shows the
// program afresh, so it never waits on a worker that is gone.
function Panel() {
  const [connection, setConnection] = useState(0);
  const port = useMemo(() => chrome.runtime.connect({ name: VIEW_PORT }), [connection]);
  const transport = useMemo(() => createChannelTransport(portChannel(port), { hostsBrowserStore: true }), [port]);
  useEffect(() => {
    const keepAlive = setInterval(() => port.postMessage(KEEP_ALIVE), KEEP_ALIVE_MS);
    const reconnect = () => setConnection((n) => n + 1);
    port.onDisconnect.addListener(reconnect);
    return () => {
      clearInterval(keepAlive);
      port.onDisconnect.removeListener(reconnect);
      port.disconnect();
    };
  }, [port]);
  return (
    <OrbPreview
      key={connection}
      schema={schema}
      transport={transport}
      kernelLoader={loadPanelKernel}
      canvas3d={makeCanvas3D}
      sceneCanvas={makeSceneCanvas}
      initialPagePath="/"
      onConsentAsk={consentAsk}
      height="100vh"
    />
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Panel />);
