'use client';
/**
 * NavStackProvider — the orbital-scoped client-session navigation stack.
 *
 * One provider instance per app host. Both execution paths mount it:
 * - Runtime path: OrbPreview supplies `currentPath` + `navigate` explicitly.
 * - Compiled path: the emitted App.tsx mounts `NavStackRouterBridge`, which
 *   reads react-router's location/navigate and renders this provider.
 *
 * Pure stack semantics live in lib/navStack.ts (one owner for both paths).
 * State persists to sessionStorage (per-tab) so a compiled app's full page
 * reload keeps the trail; every storage access is guarded with an in-memory
 * fallback.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { NavStackEntry } from '@almadar/core';
import { useEventBus } from '../hooks/useEventBus';
import {
  entriesFor,
  navLabelsFromItems,
  previousEntry,
  relabelCurrent,
  resolveEntryLabels,
  syncNavStack,
  type NavItemDecl,
  type NavPageDecl,
  type NavStackState,
  type PendingCrumb,
} from '../lib/navStack';

export interface NavStackApi {
  /** Stack of the current page's orbital, root-first (empty when no declared page matches). */
  entries: readonly NavStackEntry[];
  /** True when a previous entry exists for the current page's orbital. */
  canGoBack: boolean;
  /** Stage the crumb label for the entry the target page will record, then call navigate yourself. */
  beginNavigate: (href: string, crumb?: string) => void;
  /** Pop the current orbital's stack: navigate to the previous entry (no-op without one). */
  back: () => void;
  /** Navigate to an arbitrary stack entry (breadcrumb click). */
  goTo: (href: string) => void;
  /** Relabel the current page's stack entry with the loaded record's title
   *  (idempotent; no-op when the label already matches). DetailPanel calls
   *  this from the routed main slot so cold-loaded crumbs read like pushes. */
  setCurrentLabel: (label: string) => void;
  /** The app shell's declared navItems: a page reached by one shows that item's label in the trail. */
  registerNavItems: (items: readonly NavItemDecl[]) => void;
}

/**
 * Inert default: patterns render safely outside a provider (verification
 * harnesses, isolated component tests) — empty trail, no-op back.
 */
const INERT_API: NavStackApi = {
  entries: [],
  canGoBack: false,
  beginNavigate: () => undefined,
  back: () => undefined,
  goTo: () => undefined,
  setCurrentLabel: () => undefined,
  registerNavItems: () => undefined,
};

const NavStackContext = createContext<NavStackApi>(INERT_API);

/** True when no NavStackProvider is mounted above (plain React / SSR hosts). */
export function isInertNavStack(api: NavStackApi): boolean {
  return api === INERT_API;
}

export function useNavStack(): NavStackApi {
  return useContext(NavStackContext);
}

export interface NavStackProviderProps {
  pages: readonly NavPageDecl[];
  /** Concrete current path (route params substituted), e.g. /contracts/42. */
  currentPath: string;
  /** Host navigation function (SPA route change). */
  navigate: (path: string) => void;
  /** sessionStorage key; omit to keep the stack in memory only. */
  storageKey?: string;
  children: React.ReactNode;
}

function loadStored(storageKey: string | undefined): NavStackState {
  if (!storageKey) return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as NavStackState;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function persistStored(storageKey: string | undefined, state: NavStackState): void {
  if (!storageKey) return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota) — in-memory state still works.
  }
}

function sameNavItems(a: readonly NavItemDecl[], b: readonly NavItemDecl[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const other = b[i];
    return item.href === other.href && item.label === other.label && sameNavItems(item.children ?? [], other.children ?? []);
  });
}

export const NavStackProvider: React.FC<NavStackProviderProps> = ({
  pages,
  currentPath,
  navigate,
  storageKey,
  children,
}) => {
  const [state, setState] = useState<NavStackState>(() => loadStored(storageKey));
  const [navItems, setNavItems] = useState<readonly NavItemDecl[]>([]);
  const pendingCrumbRef = useRef<PendingCrumb | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const pending = pendingCrumbRef.current;
    pendingCrumbRef.current = null;
    setState((prev) => {
      const next = syncNavStack(prev, pages, currentPath, pending);
      if (next.state !== prev) persistStored(storageKey, next.state);
      return next.state;
    });
  }, [currentPath, pages, storageKey]);

  const beginNavigate = useCallback((href: string, crumb?: string) => {
    pendingCrumbRef.current = crumb !== undefined && crumb !== '' ? { href, crumb } : null;
  }, []);

  const back = useCallback(() => {
    const prev = previousEntry(stateRef.current, pages, currentPath);
    if (prev) navigate(prev.href);
  }, [pages, currentPath, navigate]);

  const goTo = useCallback(
    (href: string) => {
      navigate(href);
    },
    [navigate],
  );

  const setCurrentLabel = useCallback(
    (label: string) => {
      setState((prev) => {
        const next = relabelCurrent(prev, pages, currentPath, label);
        if (next !== prev) persistStored(storageKey, next);
        return next;
      });
    },
    [pages, currentPath, storageKey],
  );

  const registerNavItems = useCallback((items: readonly NavItemDecl[]) => {
    setNavItems((prev) => (sameNavItems(prev, items) ? prev : items));
  }, []);

  const navLabels = useMemo(() => navLabelsFromItems(pages, navItems), [pages, navItems]);

  const entries = useMemo(
    () => resolveEntryLabels(entriesFor(state, pages, currentPath), pages, navLabels),
    [state, pages, currentPath, navLabels],
  );

  const api = useMemo<NavStackApi>(
    () => ({
      entries,
      canGoBack: previousEntry(state, pages, currentPath) !== null,
      beginNavigate,
      back,
      goTo,
      setCurrentLabel,
      registerNavItems,
    }),
    [entries, state, pages, currentPath, beginNavigate, back, goTo, setCurrentLabel, registerNavItems],
  );

  return <NavStackContext.Provider value={api}>{children}</NavStackContext.Provider>;
};

NavStackProvider.displayName = 'NavStackProvider';

export interface NavStackRouterBridgeProps {
  pages: readonly NavPageDecl[];
  storageKey?: string;
  children: React.ReactNode;
}

/**
 * Compiled-path host: binds NavStackProvider to react-router. Must render
 * inside a Router (the emitted App.tsx mounts it directly under
 * BrowserRouter).
 */
export const NavStackRouterBridge: React.FC<NavStackRouterBridgeProps> = ({
  pages,
  storageKey = 'almadar:navstack',
  children,
}) => {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const navigate = useCallback(
    (path: string) => {
      routerNavigate(path);
    },
    [routerNavigate],
  );
  const eventBus = useEventBus();
  useEffect(
    () =>
      eventBus.on('UI:NAVIGATE', (event) => {
        const url = event.payload?.url;
        if (typeof url === 'string' && url.length > 0) routerNavigate(url);
      }),
    [eventBus, routerNavigate],
  );
  return (
    <NavStackProvider
      pages={pages}
      currentPath={location.pathname}
      navigate={navigate}
      storageKey={storageKey}
    >
      {children}
    </NavStackProvider>
  );
};

NavStackRouterBridge.displayName = 'NavStackRouterBridge';

export type { NavPageDecl } from '../lib/navStack';
