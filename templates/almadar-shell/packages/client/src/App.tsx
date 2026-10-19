/**
 * App (kernel host)
 *
 * The resolved program renders through `@almadar/ui`'s renderer on the WebAssembly kernel;
 * events travel to the server's kernel over `/api/orbitals`. Nothing here is the program's own:
 * its locale, direction, themes and language data come from the `ClientManifest` and locale
 * messages `main.tsx` reads at startup, so one build of this client serves every program.
 *
 * @packageDocumentation
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { normalizeUserContext, type OrbitalSchema } from '@almadar/core';
import { createHttpTransport, deriveCarriesCircuitState } from '@almadar/runtime';
import { I18nProvider, createTranslate } from '@almadar/ui/hooks';
import { KernelEngineProvider } from '@almadar/ui/providers';
import { OrbPreview } from '@almadar/ui/runtime';
import type { ClientManifest } from '@almadar/core';
import { loadProgram } from './client-program';
import { AuthProvider, useAuthContext } from './features/auth';
import Login from './features/auth/components/Login';
import { loadKernel, loadLanguage } from './kernel-host';
import { ThemeProvider } from '@almadar/ui/context';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

function KernelApp(): React.ReactElement | null {
  const [program, setProgram] = useState<OrbitalSchema | undefined>(undefined);
  const [failure, setFailure] = useState<Error | undefined>(undefined);
  useEffect(() => {
    loadProgram().then(setProgram, setFailure);
  }, []);
  const { auth, user, authority, signOut } = useAuthContext();
  const location = useLocation();
  const navigate = useNavigate();
  const firstPath = useRef(location.pathname);
  const viewer = useMemo(
    () => (user ? normalizeUserContext({ ...user.claims, uid: user.uid, email: user.email, name: user.name }) : undefined),
    [user],
  );
  const accessToken = useCallback(async (): Promise<string | undefined> => (auth ? auth.idToken() : undefined), [auth]);
  const http = useMemo(() => createHttpTransport({ serverUrl: `${API_BASE}/api/orbitals`, getAccessToken: accessToken }), [accessToken]);
  // The server booted with this program and serves no `/register`: a route that replaced the app's program would be a hole, so the client reports it registered.
  const transport = useMemo(
    () => ({ ...http, register: async () => ({ success: true, carriesCircuitState: deriveCarriesCircuitState('stateless') }), unregister: async () => undefined }),
    [http],
  );
  if (failure) throw failure;
  if (!program) return null;
  return (
    <OrbPreview
      key={viewer?.id ?? 'anonymous'}
      schema={program}
      transport={transport}
      height="auto"
      className="border-0 rounded-none"
      initialPagePath={firstPath.current}
      onPageChange={(path) => navigate(path)}
      user={viewer ?? null}
      authority={authority}
      onSignIn={(returnTo) => navigate('/login', { state: returnTo !== undefined ? { returnTo } : undefined })}
      onSignOut={() => void signOut()}
    />
  );
}

export interface AppProps {
  manifest: ClientManifest;
  /** The program's locale messages, `$`-prefixed metadata keys removed. */
  messages: Record<string, string>;
}

export function App({ manifest, messages }: AppProps): React.ReactElement {
  const i18nValue = useMemo(
    () => ({ locale: manifest.locale, direction: manifest.direction, messages, t: createTranslate(messages) }),
    [manifest, messages],
  );
  const themeProps =
    manifest.themes.length > 0
      ? { themes: manifest.themes, defaultTheme: manifest.defaultTheme ?? undefined, defaultMode: manifest.defaultMode }
      : {};
  return (
    <I18nProvider value={i18nValue} documentRoot>
      <ThemeProvider {...themeProps}>
        <KernelEngineProvider loader={loadKernel} {...(manifest.language ? { languageLoader: loadLanguage } : {})}>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="*" element={<KernelApp />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </KernelEngineProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

export default App;
