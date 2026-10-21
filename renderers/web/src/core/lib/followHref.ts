import { isInertNavStack, type NavStackApi } from '../providers/NavStackContext';

/** True for an absolute URL (`https:`, `mailto:`, …) that must load outside the app. */
export function isAbsoluteHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/** Follow an href: an in-page `#anchor` scrolls to it, an absolute URL loads, a path goes through the nav stack (or loads when there is none). */
export function followHref(href: string, navStack: NavStackApi): void {
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    target?.scrollIntoView({ behavior: 'smooth' });
    // Move focus with the view (skip links): focus() is a no-op on unfocusable targets.
    target?.focus({ preventScroll: true });
  } else if (isAbsoluteHref(href) || isInertNavStack(navStack)) {
    window.location.assign(href);
  } else {
    navStack.goTo(href);
  }
}
