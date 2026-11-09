/**
 * The locale a page renders under: the declared locale its path names (`/ar/...`), else the program's
 * first declared locale (`localeOfPath`, the twin of the compiler's per-route locale), else the
 * manifest's. Its messages are the program's own (`messages`), and its direction is set on the
 * document, so a route change to another language switches the messages the renderer and the kernel use.
 *
 * @packageDocumentation
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { localeDirection, localeOfPath, type ClientManifest, type OrbitalSchema } from '@almadar/core';
import { I18nProvider, createTranslate, type I18nContextValue } from '@almadar/shell-web/core';
import { loadProgram } from './client-program';

/** The provider value of `locale`: the program's catalog, with built-in labels from the UI's catalog for that locale. */
export function localeValue(program: OrbitalSchema, locale: string): I18nContextValue {
  const messages = program.messages?.[locale] ?? {};
  return { locale, direction: localeDirection(locale), messages, t: createTranslate(messages, locale) };
}

export function LocaleRoot({ manifest, children }: { manifest: ClientManifest; children: React.ReactNode }): React.ReactElement | null {
  const { pathname } = useLocation();
  const [program, setProgram] = useState<OrbitalSchema | undefined>(undefined);
  const [failure, setFailure] = useState<Error | undefined>(undefined);
  useEffect(() => {
    loadProgram().then(setProgram, setFailure);
  }, []);
  const locale = program === undefined ? undefined : (localeOfPath(pathname, program.locales ?? []) ?? manifest.locale);
  const value = useMemo(() => (program === undefined || locale === undefined ? undefined : localeValue(program, locale)), [program, locale]);
  if (failure) throw failure;
  if (value === undefined) return null;
  return <I18nProvider value={value} documentRoot>{children}</I18nProvider>;
}
