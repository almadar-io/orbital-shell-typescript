'use client';
/**
 * Unified ThemeContext - Single provider for theme and color mode
 *
 * Combines design theme selection (glass, wireframe, etc.) with
 * color mode (light/dark) into a single, simple system.
 *
 * Uses a single data attribute: data-theme="glass-light" or data-theme="glass-dark"
 *
 * @packageDocumentation
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { createLogger } from "@almadar/logger";

const log = createLogger("almadar:ui:theme");

/** Color mode preference */
export type ColorMode = "light" | "dark" | "system";

/** Resolved color mode (what's actually applied) */
export type ResolvedMode = "light" | "dark";

/** Theme definition */
export interface UIThemeDefinition {
  /** Theme identifier (e.g., "glass", "wireframe") */
  name: string;
  /** Display name for UI (e.g., "Ocean Blue") */
  displayName?: string;
  /** Whether this theme has light mode styles */
  hasLightMode?: boolean;
  /** Whether this theme has dark mode styles */
  hasDarkMode?: boolean;
}

/** Built-in themes available in the design system — generated from the core presets. */
export { BUILT_IN_THEMES } from './builtInThemes';
import { BUILT_IN_THEMES } from './builtInThemes';

/** Theme context value */
interface ThemeContextValue {
  /** Current theme name */
  theme: string;
  /** Current color mode setting (may be 'system') */
  mode: ColorMode;
  /** Resolved color mode (always 'light' or 'dark') */
  resolvedMode: ResolvedMode;
  /** Set the theme */
  setTheme: (theme: string) => void;
  /** Set the color mode */
  setMode: (mode: ColorMode) => void;
  /** Toggle between light and dark modes */
  toggleMode: () => void;
  /** Available themes */
  availableThemes: UIThemeDefinition[];
  /** The full theme string applied to data-theme (e.g., "glass-light") */
  appliedTheme: string;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * The theme in effect at a point of the React tree: what `data-theme`, mode
 * class and inline token variables a subtree renders under. Portaled UI reads
 * it so a modal takes the theme of the place it opened from.
 */
export interface ThemeScope {
  theme?: string;
  mode?: ResolvedMode;
  vars?: Readonly<Record<string, string>>;
  /**
   * A host's explicit theme pick (e.g. the playground picker): every
   * `data-theme` a component declares inside this scope renders this key
   * instead. Set only by `OrbitalThemeProvider`'s `override`.
   */
  override?: string;
}

export const ThemeScopeContext = createContext<ThemeScope>({});

export function useThemeScope(): ThemeScope {
  return useContext(ThemeScopeContext);
}

/**
 * The mode a registry `data-theme` key was built with: `<name>-light` /
 * `<name>-dark` of a declared theme that has that mode (the same construction
 * as `appliedTheme`). Undefined for any key no declared theme builds.
 */
export function registryKeyMode(
  key: string,
  themes: readonly UIThemeDefinition[],
): ResolvedMode | undefined {
  return registryKeyTheme(key, themes)?.mode;
}

/** The declared theme and mode a registry key was built from, or undefined. */
export function registryKeyTheme(
  key: string,
  themes: readonly UIThemeDefinition[],
): { theme: UIThemeDefinition; mode: ResolvedMode } | undefined {
  for (const t of themes) {
    if (key === `${t.name}-light` && themeHasMode(t, "light")) return { theme: t, mode: "light" };
    if (key === `${t.name}-dark` && themeHasMode(t, "dark")) return { theme: t, mode: "dark" };
  }
  return undefined;
}

/**
 * A declared registry key as it renders: the key names a theme and its starting
 * mode, and the viewer's mode wins when the theme has it. A key no declared
 * theme builds passes through with no mode.
 */
export function keyInViewerMode(
  key: string,
  themes: readonly UIThemeDefinition[],
  viewerMode: ResolvedMode,
): { key: string; mode?: ResolvedMode } {
  const keyTheme = registryKeyTheme(key, themes);
  if (keyTheme === undefined) return { key };
  const mode = themeHasMode(keyTheme.theme, viewerMode) ? viewerMode : keyTheme.mode;
  return { key: `${keyTheme.theme.name}-${mode}`, mode };
}

export function themeHasMode(theme: UIThemeDefinition, mode: ResolvedMode): boolean {
  return mode === "light" ? theme.hasLightMode !== false : theme.hasDarkMode !== false;
}

/** The color mode in effect at this point of the tree: a pinned orbital theme's, else the document's. */
export function useScopedMode(): ResolvedMode {
  const scope = useThemeScope();
  const { resolvedMode } = useTheme();
  return scope.mode ?? resolvedMode;
}

/** Storage keys */
const THEME_STORAGE_KEY = "theme";
const MODE_STORAGE_KEY = "theme-mode";

/**
 * Get the system preferred color scheme
 */
function getSystemMode(): ResolvedMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Resolve the color mode (handle 'system' preference)
 */
function resolveMode(mode: ColorMode): ResolvedMode {
  if (mode === "system") {
    return getSystemMode();
  }
  return mode;
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Available themes (will be merged with built-in themes) */
  themes?: readonly UIThemeDefinition[] | UIThemeDefinition[];
  /** Default theme name */
  defaultTheme?: string;
  /** Default color mode */
  defaultMode?: ColorMode;
  /** Optional target element ref — when provided, theme attributes are applied to this element instead of document.documentElement */
  targetRef?: React.RefObject<HTMLElement>;
}

/**
 * Unified ThemeProvider component
 *
 * @example
 * ```tsx
 * // Basic usage with built-in themes
 * <ThemeProvider defaultTheme="wireframe" defaultMode="light">
 *   <App />
 * </ThemeProvider>
 *
 * // With custom themes from orbital schema
 * import { THEMES } from './generated/theme-manifest';
 * <ThemeProvider themes={THEMES} defaultTheme="glass" defaultMode="system">
 *   <App />
 * </ThemeProvider>
 * ```
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  themes = [],
  defaultTheme = "wireframe",
  defaultMode = "system",
  targetRef,
}) => {
  // Merge built-in themes with custom themes
  const availableThemes = useMemo(() => {
    const themeMap = new Map<string, UIThemeDefinition>();
    // Add built-in themes first
    BUILT_IN_THEMES.forEach((t) => themeMap.set(t.name, t));
    // Custom themes override built-in if same name
    themes.forEach((t) => themeMap.set(t.name, t));
    return Array.from(themeMap.values());
  }, [themes]);

  // When targetRef is provided, this is a scoped (embedded) provider — skip localStorage
  const isScoped = !!targetRef;

  // Initialize theme from storage or default
  const [theme, setThemeState] = useState<string>(() => {
    if (isScoped || typeof window === "undefined") return defaultTheme;
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    // Validate stored theme exists
    const validThemes = [
      ...BUILT_IN_THEMES.map((t) => t.name),
      ...themes.map((t) => t.name),
    ];
    if (stored && validThemes.includes(stored)) {
      return stored;
    }
    return defaultTheme;
  });

  // Initialize mode from storage or default
  const [mode, setModeState] = useState<ColorMode>(() => {
    if (isScoped || typeof window === "undefined") return defaultMode;
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return defaultMode;
  });

  // Resolved mode (handles 'system' preference)
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() =>
    resolveMode(mode),
  );

  // The applied theme string (e.g., "glass-light")
  const appliedTheme = useMemo(
    () => `${theme}-${resolvedMode}`,
    [theme, resolvedMode],
  );

  // Update resolved mode when mode changes or system preference changes
  useEffect(() => {
    const updateResolved = () => {
      setResolvedMode(resolveMode(mode));
    };

    updateResolved();

    // Listen for system theme changes
    if (mode === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => updateResolved();
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    return undefined;
  }, [mode]);

  // Apply theme to target element (or document root if no targetRef)
  useEffect(() => {
    // When scoped, only apply to the target element — never touch document root
    if (isScoped) {
      if (targetRef?.current) {
        targetRef.current.setAttribute("data-theme", appliedTheme);
        targetRef.current.classList.remove("light", "dark");
        targetRef.current.classList.add(resolvedMode);
      }
      return;
    }
    const root = document.documentElement;
    root.setAttribute("data-theme", appliedTheme);

    // Set color-scheme so native form controls (<select> dropdowns, scrollbars,
    // date pickers) render in the correct mode — without this, the OS dropdown
    // background doesn't match the themed text color.
    root.style.colorScheme = resolvedMode;

    // Also set class for Tailwind dark: variant compatibility
    root.classList.remove("light", "dark");
    root.classList.add(resolvedMode);
  }, [appliedTheme, resolvedMode, targetRef, isScoped]);

  // Set theme
  const setTheme = useCallback(
    (newTheme: string) => {
      const validTheme = availableThemes.find((t) => t.name === newTheme);
      if (validTheme) {
        setThemeState(newTheme);
        if (!isScoped && typeof window !== "undefined") {
          localStorage.setItem(THEME_STORAGE_KEY, newTheme);
        }
      } else {
        log.warn("Theme not found", {
          theme: newTheme,
          available: availableThemes.map((t) => t.name),
        });
      }
    },
    [availableThemes],
  );

  // Set mode
  const setMode = useCallback((newMode: ColorMode) => {
    setModeState(newMode);
    if (!isScoped && typeof window !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, newMode);
    }
  }, []);

  // Toggle between light and dark
  const toggleMode = useCallback(() => {
    const newMode: ColorMode = resolvedMode === "dark" ? "light" : "dark";
    setMode(newMode);
  }, [resolvedMode, setMode]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      mode,
      resolvedMode,
      setTheme,
      setMode,
      toggleMode,
      availableThemes,
      appliedTheme,
    }),
    [
      theme,
      mode,
      resolvedMode,
      setTheme,
      setMode,
      toggleMode,
      availableThemes,
      appliedTheme,
    ],
  );

  const scope = useMemo<ThemeScope>(() => ({ theme: appliedTheme, mode: resolvedMode }), [appliedTheme, resolvedMode]);

  return (
    <ThemeContext.Provider value={contextValue}>
      <ThemeScopeContext.Provider value={scope}>{children}</ThemeScopeContext.Provider>
    </ThemeContext.Provider>
  );
};

/**
 * Hook for accessing theme context
 *
 * @returns Theme context value
 *
 * @example
 * ```tsx
 * const { theme, resolvedMode, toggleMode, setTheme } = useTheme();
 *
 * // Toggle dark mode
 * <button onClick={toggleMode}>
 *   {resolvedMode === 'dark' ? 'Light' : 'Dark'}
 * </button>
 *
 * // Change theme
 * <select value={theme} onChange={(e) => setTheme(e.target.value)}>
 *   {availableThemes.map(t => (
 *     <option key={t.name} value={t.name}>{t.displayName || t.name}</option>
 *   ))}
 * </select>
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    // Return a default implementation for storybook/testing
    return {
      theme: "wireframe",
      mode: "light",
      resolvedMode: "light",
      setTheme: () => {},
      setMode: () => {},
      toggleMode: () => {},
      availableThemes: BUILT_IN_THEMES,
      appliedTheme: "wireframe-light",
    };
  }
  return context;
}

// Legacy exports for backward compatibility
export type Theme = ColorMode;
export type ResolvedTheme = ResolvedMode;
export type DesignTheme = UIThemeDefinition;

export default ThemeContext;
