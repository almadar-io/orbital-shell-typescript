import { localeDirection, pathLocale, type OrbitalSchema } from '@almadar/core';
import { createTranslate, type I18nContextValue } from '../core/hooks/useTranslate';

/**
 * The locale a previewed program's route names, as the provider value it renders under: a preview follows its own
 * route as a served app's `LocaleRoot` follows the URL (EXEC: the locale is the route), and keeps the host's locale
 * when its route names none.
 */
export function routeLocaleValue(path: string | undefined, schema: OrbitalSchema | undefined, inherited: string): I18nContextValue | undefined {
  const locale = path === undefined || schema === undefined ? undefined : pathLocale(path, schema.locales ?? []);
  if (locale === undefined || locale === inherited) return undefined;
  const messages = schema?.messages?.[locale] ?? {};
  return { locale, direction: localeDirection(locale), messages, t: createTranslate(messages, locale) };
}
