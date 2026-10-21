'use client';
/**
 * useTranslate — i18n hook for Almadar UI components.
 *
 * Provides locale-aware string translation via React context.
 * No provider = passthrough: t('key') returns 'key' as-is (never crashes).
 *
 * Usage in organisms:
 *   const { t, locale, direction } = useTranslate();
 *   <Button>{t('common.save')}</Button>
 *   <Typography>{t('table.showing', { count: 5, total: 20 })}</Typography>
 *
 * Templates MUST NOT use this hook (flattener rule). They receive
 * translated strings via entity props from the organism above.
 */

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { DEFAULT_CURRENCY, type FormatContext } from '../lib/format';
import coreLocaleRaw from '../locales/en.json';
import arLocaleRaw from '../locales/ar.json';
import slLocaleRaw from '../locales/sl.json';

// Strip $meta (object, not a string) so the lookup is Record<string, string>
const { $meta: _meta, ...coreMessages } = coreLocaleRaw;
const coreLocale: Record<string, string> = coreMessages;
const { $meta: _arMeta, ...arMessages } = arLocaleRaw;
const { $meta: _slMeta, ...slMessages } = slLocaleRaw;
/** The UI's own catalog per locale, the fallback for built-in component labels. */
const uiLocales: Readonly<Record<string, Record<string, string>>> = { en: coreLocale, ar: arMessages, sl: slMessages };

export type TranslateFunction = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export interface I18nContextValue {
  /** Current locale code (e.g. 'en', 'ar', 'sl') */
  locale: string;
  /** Text direction for the current locale */
  direction: 'ltr' | 'rtl';
  /** Translate a key, with optional interpolation params */
  t: TranslateFunction;
  /** The active locale's program catalog (qualified `<behavior>:<key>` → message): the runtime evaluates `i18n/t` against it. */
  messages?: Readonly<Record<string, string>>;
  /** ISO 4217 currency of the app's money values, declared by the host with the locale (e.g. `SAR` for an ar-SA app) */
  currency?: string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  direction: 'ltr',
  t: (key, params) => {
    let msg = coreLocale[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.split(`{{${k}}}`).join(String(v));
      }
    }
    return msg;
  },
});

I18nContext.displayName = 'I18nContext';

/**
 * Provider component — wrap your app or Storybook decorator with this.
 *
 * ```tsx
 * <I18nProvider value={{ locale: 'ar', direction: 'rtl', t: createTranslate(arMessages) }}>
 *   <App />
 * </I18nProvider>
 * ```
 */
export interface I18nProviderProps {
  value: I18nContextValue;
  children?: React.ReactNode;
  /** The app's root provider: mirrors locale + direction onto `<html lang dir>`.
   *  Embedded previews omit it so they never rewrite their host document. */
  documentRoot?: boolean;
}

export function I18nProvider({ value, children, documentRoot }: I18nProviderProps): React.ReactElement {
  useEffect(() => {
    if (!documentRoot) return;
    document.documentElement.lang = value.locale;
    document.documentElement.dir = value.direction;
  }, [documentRoot, value.locale, value.direction]);
  return React.createElement(I18nContext.Provider, { value }, children);
}

/**
 * Hook to access the current locale and translate function.
 * Safe to call without a provider — returns passthrough t().
 */
export function useTranslate(): I18nContextValue {
  return useContext(I18nContext);
}

/** The viewer's locale and its catalog, for `i18n/t` / `@locale` evaluated in the browser. */
export interface RenderI18n {
  locale: string;
  messages: Readonly<Record<string, string>>;
}

/** The provider's locale + catalog as one identity-stable value; undefined when the host supplied no catalog. */
export function useRenderI18n(): RenderI18n | undefined {
  const { locale, messages } = useContext(I18nContext);
  return useMemo(() => (messages !== undefined ? { locale, messages } : undefined), [locale, messages]);
}

/** The app's formatting settings for `formatValue`: its locale, currency and translated Yes/No. */
export function useFormatContext(): FormatContext {
  const { t, locale, currency } = useContext(I18nContext);
  return useMemo(
    () => ({ locale, currency: currency ?? DEFAULT_CURRENCY, booleanLabels: { yes: t('common.yes'), no: t('common.no') } }),
    [t, locale, currency],
  );
}

/**
 * Create a translate function from a flat messages object.
 *
 * ```ts
 * const t = createTranslate({ 'common.save': 'Save', 'table.showing': 'Showing {{count}} of {{total}}' });
 * t('common.save') // → 'Save'
 * t('table.showing', { count: 5, total: 20 }) // → 'Showing 5 of 20'
 * t('missing.key') // → 'missing.key' (fallback)
 * ```
 *
 * Pass `locale` so built-in component labels the app catalog doesn't carry
 * come from the UI's own catalog for that locale before English.
 */
export function createTranslate(
  messages: Record<string, string>,
  locale?: string,
): TranslateFunction {
  const uiCatalog = locale !== undefined ? uiLocales[locale] : undefined;
  return (key, params) => {
    let msg = messages[key] ?? uiCatalog?.[key] ?? coreLocale[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.split(`{{${k}}}`).join(String(v));
      }
    }
    return msg;
  };
}
