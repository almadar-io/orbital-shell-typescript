/**
 * The locale a page renders under: the declared locale its path names (`/ar/...`), else the program's
 * first declared locale (`localeOfPath`, the twin of the compiler's per-route locale), else the
 * manifest's. Its catalog (`locales/<locale>.json`) is fetched once and its direction set on the
 * document, so a route change to another language switches the messages the renderer and the kernel use.
 *
 * @packageDocumentation
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { localeDirection, localeOfPath, type ClientManifest, type JsonValue } from '@almadar/core';
import { I18nProvider, createTranslate } from '@almadar/shell-web/core';
import { loadProgram } from './client-program';

function messagesOf(locale: string, catalog: JsonValue): Record<string, string> {
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error(`locales/${locale}.json: not an object`);
  }
  const messages: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (!key.startsWith('$') && typeof value === 'string') messages[key] = value;
  }
  return messages;
}

const catalogs = new Map<string, Promise<Record<string, string>>>();

function loadCatalog(locale: string): Promise<Record<string, string>> {
  const held = catalogs.get(locale);
  if (held !== undefined) return held;
  const loading = fetch(`${import.meta.env.BASE_URL}locales/${locale}.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`locales/${locale}.json: ${response.status} ${response.statusText}`);
      const body: JsonValue = await response.json();
      return messagesOf(locale, body);
    })
    .catch((error: Error) => {
      catalogs.delete(locale);
      throw error;
    });
  catalogs.set(locale, loading);
  return loading;
}

export function LocaleRoot({ manifest, children }: { manifest: ClientManifest; children: React.ReactNode }): React.ReactElement | null {
  const { pathname } = useLocation();
  const [declared, setDeclared] = useState<readonly string[] | undefined>(undefined);
  const [failure, setFailure] = useState<Error | undefined>(undefined);
  useEffect(() => {
    loadProgram().then((program) => setDeclared(program.locales ?? []), setFailure);
  }, []);
  const locale = declared === undefined ? undefined : (localeOfPath(pathname, declared) ?? manifest.locale);
  const [shown, setShown] = useState<{ locale: string; messages: Record<string, string> } | undefined>(undefined);
  useEffect(() => {
    if (locale === undefined) return;
    let live = true;
    loadCatalog(locale).then((messages) => { if (live) setShown({ locale, messages }); }, (error: Error) => { if (live) setFailure(error); });
    return () => { live = false; };
  }, [locale]);
  const value = useMemo(
    () => (shown === undefined ? undefined : { locale: shown.locale, direction: localeDirection(shown.locale), messages: shown.messages, t: createTranslate(shown.messages) }),
    [shown],
  );
  if (failure) throw failure;
  if (value === undefined) return null;
  return <I18nProvider value={value} documentRoot>{children}</I18nProvider>;
}
