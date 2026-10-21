/**
 * The active page's document head on client navigation — the same declared
 * contract the build writes into each route document: title, description,
 * canonical, social tags and the robots directive, with `i18n/t` metadata
 * resolved from the active locale's catalog. The tags it writes are marked
 * and replaced on every page change; entering an `authenticated` or
 * `noindex` page drops the public tags and declares `noindex`.
 *
 * @packageDocumentation
 */

import { useEffect } from 'react';
import { resolvePageMeta, type LocaleAlternate, type PageAccess, type PageIndexing, type PageMeta } from '@almadar/core';
import { useTranslate } from '../core';

export interface PageHeadInput {
  title?: PageMeta;
  description?: PageMeta;
  access?: PageAccess;
  indexing?: PageIndexing;
  /** The app's `origin:`, for the canonical URL. */
  origin?: string;
  /** The app's `siteName:` — the document title of a page that declares none. */
  siteName?: string;
  /** The concrete path on screen. */
  path: string;
  /** The page's translations (`localeAlternates`), written as hreflang links. */
  alternates?: readonly LocaleAlternate[];
  /** The app's first locale, the `x-default` alternate. */
  defaultLocale?: string;
}

const OWNED = 'data-orb-head';
let shellTitle: string | undefined;

function ownedTag(tag: 'meta' | 'link', attrs: Record<string, string>): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute(OWNED, '');
  return el;
}

/** Writes `input`'s head into the document; `null` writes nothing. */
export function usePageHead(input: PageHeadInput | null): void {
  const { messages, locale } = useTranslate();
  const title = input ? resolvePageMeta(input.title, (k) => messages?.[k]) : undefined;
  const description = input ? resolvePageMeta(input.description, (k) => messages?.[k]) : undefined;
  const isPublic = input?.access !== 'authenticated' && input?.indexing !== 'noindex';
  const canonical = input?.origin !== undefined ? `${input.origin.replace(/\/+$/, '')}${input.path}` : undefined;
  const siteName = input?.siteName;
  const active = input !== null;
  const originBase = input?.origin?.replace(/\/+$/, '');
  const hreflang: Array<[string, string]> = [];
  if (originBase !== undefined) {
    for (const alt of input?.alternates ?? []) hreflang.push([alt.locale, `${originBase}${alt.path}`]);
    const fallback = input?.alternates?.find((alt) => alt.locale === input.defaultLocale);
    if (fallback !== undefined) hreflang.push(['x-default', `${originBase}${fallback.path}`]);
  }
  // One `<locale> <href>` line per alternate: a locale has no space, a URL no newline.
  const hreflangKey = hreflang.map(([lang, href]) => `${lang} ${href}`).join('\n');

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    shellTitle ??= document.title;
    document.title = title ?? siteName ?? shellTitle;
    const tags: HTMLElement[] = [];
    if (!isPublic) tags.push(ownedTag('meta', { name: 'robots', content: 'noindex' }));
    if (isPublic && description !== undefined) {
      tags.push(ownedTag('meta', { name: 'description', content: description }));
      tags.push(ownedTag('meta', { property: 'og:description', content: description }));
    }
    if (isPublic && title !== undefined) tags.push(ownedTag('meta', { property: 'og:title', content: title }));
    if (isPublic && canonical !== undefined) {
      tags.push(ownedTag('link', { rel: 'canonical', href: canonical }));
      tags.push(ownedTag('meta', { property: 'og:url', content: canonical }));
    }
    if (isPublic && siteName !== undefined) tags.push(ownedTag('meta', { property: 'og:site_name', content: siteName }));
    if (isPublic) tags.push(ownedTag('meta', { property: 'og:locale', content: locale }));
    if (isPublic && hreflangKey !== '') {
      for (const line of hreflangKey.split('\n')) {
        const space = line.indexOf(' ');
        tags.push(ownedTag('link', { rel: 'alternate', hreflang: line.slice(0, space), href: line.slice(space + 1) }));
      }
    }
    // The build's route document marks its tags the same way, so the first
    // client navigation replaces them too; unmarked tags are someone else's.
    for (const stale of Array.from(document.head.querySelectorAll(`[${OWNED}]`))) stale.remove();
    for (const tag of tags) document.head.appendChild(tag);
    return () => {
      for (const tag of tags) tag.remove();
    };
  }, [active, title, description, isPublic, canonical, siteName, locale, hreflangKey]);
}
