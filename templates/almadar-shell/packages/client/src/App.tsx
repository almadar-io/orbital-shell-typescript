/**
 * App (kernel host)
 *
 * The resolved program renders through `@almadar/shell-web`'s renderer on the WebAssembly kernel;
 * events travel to the server's kernel over `/api/orbitals`. Nothing here is the program's own:
 * its locale, direction, themes and language data come from the `ClientManifest` and locale
 * messages `main.tsx` reads at startup, so one build of this client serves every program.
 *
 * @packageDocumentation
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { OrbitalSchema } from '@almadar/core';
import { createHttpTransport, deriveCarriesCircuitState, FetchSchemaLoader } from '@almadar/shell-runtime';
import { KernelEngineProvider, type KernelEngineHost } from '@almadar/shell-web/providers';
import { OrbPreview } from '@almadar/shell-web/runtime';
import type { ClientManifest } from '@almadar/core';
import { hostSignIn } from '@almadar/shell-web/auth/react';
import { registerHostPushSubscribe, webPushSubscribe } from '@almadar/shell-web/lib';
import { loadProgram, serverBase } from './client-program';
import { AuthProvider, PersonaSwitcher, useAuthContext } from './features/auth';
import Login from './features/auth/components/Login';
import { loadKernel } from './kernel-host';
import { Canvas3D, SceneCanvas } from '@almadar/kernel/client';
import { LocaleRoot } from './locale';
import { Box, ThemeProvider } from '@almadar/shell-web/core';

/** The browser's GPU answerer, made once the kernel module has loaded: a program's `gpu/` asks run on WebGPU in the page. */
const makeGpu: NonNullable<KernelEngineHost['gpu']> = (module) => new module.GpuHost();
const makeCanvas3D = (canvas: HTMLCanvasElement): Promise<Canvas3D> => Canvas3D.create(canvas);
const makeSceneCanvas = (canvas: HTMLCanvasElement): Promise<SceneCanvas> => SceneCanvas.create(canvas);
// `orb compile --mode client --no-server` writes VITE_SERVER=none: a static site whose program runs wholly in the browser.
const SERVERLESS = import.meta.env.VITE_SERVER === 'none';
// The lazy pages' programs sit under the client root, at each page's orbRef.
const CLIENT_ROOT = new URL(import.meta.env.BASE_URL, window.location.origin).href;
const lazyLoader = new FetchSchemaLoader(CLIENT_ROOT);

function KernelApp({ programPath }: { programPath: string }): React.ReactElement | null {
  const [program, setProgram] = useState<OrbitalSchema | undefined>(undefined);
  const [failure, setFailure] = useState<Error | undefined>(undefined);
  useEffect(() => {
    loadProgram(programPath).then(setProgram, setFailure);
  }, [programPath]);
  const { auth, user, authority, signOut } = useAuthContext();
  const signInAsk = useMemo(() => (auth === null ? undefined : hostSignIn(auth)), [auth]);
  const location = useLocation();
  const navigate = useNavigate();
  const accessToken = useCallback(async (): Promise<string | undefined> => (auth ? auth.idToken() : undefined), [auth]);
  const apiBase = program === undefined ? undefined : serverBase(program);
  useEffect(() => (apiBase === undefined ? undefined : registerHostPushSubscribe(webPushSubscribe(apiBase))), [apiBase]);
  const http = useMemo(() => createHttpTransport({ serverUrl: `${apiBase ?? ''}/api/orbitals`, getAccessToken: accessToken }), [apiBase, accessToken]);
  // The server booted with this program and serves no `/register`: a route that replaced the app's program would be a hole, so the client reports it registered.
  const transport = useMemo(
    () => ({ ...http, register: async () => ({ success: true, carriesCircuitState: deriveCarriesCircuitState('stateless') }), unregister: async () => undefined }),
    [http],
  );
  if (failure) throw failure;
  if (!program) return null;
  // Until Firebase has restored a saved session the viewer is unknown: a page mounted then would ask the server as anonymous.
  if (!SERVERLESS && authority === 'pending') return null;
  return (
    <OrbPreview
      key={user?.uid ?? 'anonymous'}
      schema={program}
      {...(SERVERLESS ? {} : { transport })}
      lazyLoader={lazyLoader}
      schemaPath={CLIENT_ROOT}
      height="100dvh"
      frame="page"
      initialPagePath={location.pathname}
      onPageChange={(path) => navigate(path)}
      authority={authority}
      onSignIn={(returnTo) => navigate('/login', { state: returnTo !== undefined ? { returnTo } : undefined })}
      onSignOut={() => void signOut()}
      onSignInAsk={signInAsk}
    />
  );
}

export interface AppProps {
  manifest: ClientManifest;
}

export function App({ manifest }: AppProps): React.ReactElement {
  const loader = useCallback(() => loadKernel(manifest.language), [manifest.language]);
  const themeProps =
    manifest.themes.length > 0
      ? { themes: manifest.themes, defaultTheme: manifest.defaultTheme ?? undefined, defaultMode: manifest.defaultMode }
      : {};
  return (
    <ThemeProvider {...themeProps}>
      <KernelEngineProvider loader={loader} gpu={makeGpu} canvas3d={makeCanvas3D} sceneCanvas={makeSceneCanvas}>
        <AuthProvider>
          <BrowserRouter>
            <LocaleRoot manifest={manifest}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="*" element={<KernelApp programPath={manifest.program} />} />
              </Routes>
              <Box className="fixed bottom-3 left-3 z-[1000]">
                <PersonaSwitcher programPath={manifest.program} />
              </Box>
            </LocaleRoot>
          </BrowserRouter>
        </AuthProvider>
      </KernelEngineProvider>
    </ThemeProvider>
  );
}

export default App;
