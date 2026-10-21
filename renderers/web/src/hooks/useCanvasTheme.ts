import { useLayoutEffect, useState, type RefObject } from 'react';
import type { CanvasTheme } from '@almadar/core';
import { useTheme, useThemeScope } from '../core';
import { resolveCanvasTheme } from '../lib/canvasTheme';

/**
 * The theme's drawing axes resolved inside `scopeRef`, re-resolved whenever the applied or subtree
 * theme changes. `version` changes with every re-resolution, so a surface that paints imperatively
 * puts it in its draw dependencies and repaints on a theme switch. Null until the scope mounts.
 */
export function useCanvasTheme(scopeRef: RefObject<Element | null>): { theme: CanvasTheme | null; version: number } {
  const { appliedTheme } = useTheme();
  const scopeKey = JSON.stringify(useThemeScope());
  const [state, setState] = useState<{ theme: CanvasTheme | null; version: number }>({ theme: null, version: 0 });

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    const theme = resolveCanvasTheme(scope);
    setState((prev) => ({ theme, version: prev.version + 1 }));
  }, [appliedTheme, scopeKey, scopeRef]);

  return state;
}
