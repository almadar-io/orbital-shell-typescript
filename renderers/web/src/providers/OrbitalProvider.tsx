'use client';
/**
 * OrbitalProvider
 *
 * Unified provider that combines all required contexts for Orbital applications.
 * Provides a single import for both Builder preview and compiled shell.
 *
 * Combines:
 * - ThemeProvider - Theme and color mode management
 * - EventBusProvider - Page-scoped event pub/sub
 * - SelectionProvider - Selected entity tracking
 * - UserProvider - the viewer `@user.x` bindings resolve against
 *
 * Entity data flows through props (via enrichFromResponse in ServerBridge),
 * not through context. FetchedDataProvider has been removed.
 *
 * @packageDocumentation
 */

import React, { type ReactNode, useMemo } from 'react';
import type { EntityRow } from '@almadar/core';
import { ThemeProvider, type ThemeProviderProps, type UIThemeDefinition } from '../core';
import { EventBusProvider } from '../core';
import { SelectionProvider } from './SelectionProvider';
import { SuspenseConfigProvider, type SuspenseConfig } from '../components/core/organisms/UISlotRenderer';
import { VerificationProvider } from './VerificationProvider';
import { UserProvider, type UserData } from './UserContext';
import { EditorFocusProvider } from './EditorFocusContext';

// ============================================================================
// Types
// ============================================================================

export interface OrbitalProviderProps {
  children: ReactNode;

  // Theme options
  /** Custom themes (merged with built-in themes) */
  themes?: UIThemeDefinition[];
  /** Default theme name */
  defaultTheme?: string;
  /** Default color mode */
  defaultMode?: 'light' | 'dark' | 'system';
  /** Optional target element ref for scoped theme application */
  targetRef?: React.RefObject<HTMLElement>;
  /** Skip ThemeProvider (use when already inside a themed container like shadow DOM) */
  skipTheme?: boolean;

  // Debug options
  /** Enable debug logging for all providers */
  debug?: boolean;

  // Data options
  /** Initial fetched data */
  /** @deprecated No longer used. Entity data flows through server response props. */
  initialData?: Record<string, EntityRow[]>;

  // Suspense options
  /**
   * Enable Suspense mode. When true, UISlotRenderer wraps each slot in
   * `<ErrorBoundary><Suspense>` with Skeleton fallbacks.
   * Opt-in — existing isLoading prop pattern still works when false/absent.
   */
  suspense?: boolean;

  // Verification options
  /**
   * Enable verification wiring for visual testing.
   * When true, lifecycle events are recorded and exposed via
   * `window.__orbitalVerification` for Playwright/automation.
   * Default: true in development, false in production.
   */
  verification?: boolean;

  /**
   * Sandbox mode: the event bus stays context-local and does NOT register as
   * the global bus. Set for studio previews embedded in a host app (so the
   * preview's events don't clobber the host's global bus). Default false.
   */
  isolated?: boolean;

  /**
   * The signed-in viewer. Generated trait hooks read `@user.x` through
   * `useUser()`, so without this every role gate takes its negative branch and
   * every ownership-scoped list renders empty — silently, since `useUser()`
   * falls back to anonymous rather than throwing
   * (U-USERPROVIDER-MOUNTED-NOWHERE). Mounting the provider here means every
   * host that already wraps its app in OrbitalProvider only has to pass the user.
   */
  user?: UserData | null;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * OrbitalProvider - Unified context provider for Orbital applications
 *
 * Wraps your application with all required providers in the correct order.
 *
 * @example
 * ```tsx
 * // Basic usage
 * function App() {
 *   return (
 *     <OrbitalProvider>
 *       <Router>
 *         <Routes />
 *       </Router>
 *     </OrbitalProvider>
 *   );
 * }
 *
 * // With configuration
 * function App() {
 *   return (
 *     <OrbitalProvider
 *       defaultTheme="minimalist"
 *       defaultMode="dark"
 *       debug={process.env.NODE_ENV === 'development'}
 *     >
 *       <Router>
 *         <Routes />
 *       </Router>
 *     </OrbitalProvider>
 *   );
 * }
 *
 * // With custom themes from schema
 * import { THEMES } from './generated/theme-manifest';
 *
 * function App() {
 *   return (
 *     <OrbitalProvider themes={THEMES} defaultTheme="glass">
 *       <Router>
 *         <Routes />
 *       </Router>
 *     </OrbitalProvider>
 *   );
 * }
 * ```
 */
export function OrbitalProvider({
  children,
  themes,
  defaultTheme = 'wireframe',
  defaultMode = 'system',
  targetRef,
  skipTheme = false,
  debug = false,
  initialData,
  suspense = false,
  verification,
  isolated = false,
  user = null,
}: OrbitalProviderProps): React.ReactElement {
  const suspenseConfig: SuspenseConfig = useMemo(
    () => ({ enabled: suspense }),
    [suspense],
  );

  const inner = (
    <EventBusProvider debug={debug} isolated={isolated}>
      <VerificationProvider enabled={verification}>
        <UserProvider user={user}>
          <SelectionProvider debug={debug}>
            <SuspenseConfigProvider config={suspenseConfig}>
              <EditorFocusProvider>{children}</EditorFocusProvider>
            </SuspenseConfigProvider>
          </SelectionProvider>
        </UserProvider>
      </VerificationProvider>
    </EventBusProvider>
  );

  if (skipTheme) {
    return inner;
  }

  return (
    <ThemeProvider
      themes={themes}
      defaultTheme={defaultTheme}
      defaultMode={defaultMode}
      targetRef={targetRef}
    >
      {inner}
    </ThemeProvider>
  );
}

OrbitalProvider.displayName = 'OrbitalProvider';

// ============================================================================
// Re-exports for convenience
// ============================================================================



export { SelectionProvider } from './SelectionProvider';
export { UserProvider, useUser } from './UserContext';
export { EditorFocusProvider, useEditorFocus, type EditorFocus } from './EditorFocusContext';
