/**
 * In-app link interception for a hosted program (a preview or a guest view): a link click inside
 * the box becomes the program's own navigation instead of the host page's.
 */
import { useEffect, type RefObject } from 'react';
import { useHref } from 'react-router-dom';
import { createLogger } from '@almadar/logger';

const navLog = createLogger('almadar:runtime:navigation');

/** Reports the host router's href for its root: `/`, `#/` (hash), `/base` (basename). */
export function HostHrefBaseProbe({ onBase }: { onBase: (base: string) => void }): null {
  const base = useHref('/');
  useEffect(() => onBase(base), [base, onBase]);
  return null;
}

/**
 * The app path an in-app link points at, decoded with the host router's own
 * href encoding; null when the href is not one the host router produced.
 */
export function appPathFromHref(href: string, hostHrefBase: string): string | null {
  const root = hostHrefBase.endsWith('/') ? hostHrefBase.slice(0, -1) : hostHrefBase;
  if (href === root) return '/';
  if (!href.startsWith(`${root}/`)) return null;
  return href.slice(root.length);
}

export interface InAppLinkOptions {
  /** False leaves every link to the browser. */
  enabled: boolean;
  /** A sandbox: no link inside the box navigates the host; an external one opens in a new tab. */
  isolated: boolean;
  /** The host router's root href (`HostHrefBaseProbe`). */
  hostHrefBase: string;
  /** Called with the app path of an intercepted in-app link. */
  onPath: (path: string) => void;
}

/** Marks a box that intercepts its links; a link belongs to the innermost marked box around it. */
const LINK_SCOPE = 'data-in-app-links';

/**
 * Intercepts `<a>` clicks inside `ref` in the capture phase, before any React handler or native navigation. A link
 * inside a nested intercepting box (a guest inside a preview) is that box's: capture runs outermost first, so the
 * outer box leaves it alone. The click only loses its default (a router link skips a prevented click); the link's own
 * handlers, such as a drawer closing, still run.
 */
export function useInAppLinkInterceptor(ref: RefObject<HTMLElement | null>, { enabled, isolated, hostHrefBase, onPath }: InAppLinkOptions): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    el.setAttribute(LINK_SCOPE, '');
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      if (anchor.closest(`[${LINK_SCOPE}]`) !== el) return;
      const href = anchor.getAttribute('href') ?? anchor.getAttribute('to') ?? '';
      navLog.debug('click:intercepted', { href });
      const external = href.startsWith('http') || href.startsWith('mailto:');
      const appPath = external ? null : appPathFromHref(href, hostHrefBase);
      if (isolated && appPath === null) {
        e.preventDefault();
        if (external) window.open(href, '_blank', 'noopener,noreferrer');
        navLog.debug('click:sandboxed', { href, external });
        return;
      }
      if (appPath === null) {
        navLog.debug('click:skipped', { href, reason: 'not an in-app href', hostHrefBase });
        return;
      }
      e.preventDefault();
      onPath(appPath);
    };
    el.addEventListener('click', handler, true);
    return () => {
      el.removeEventListener('click', handler, true);
      el.removeAttribute(LINK_SCOPE);
    };
  }, [ref, enabled, isolated, hostHrefBase, onPath]);
}
