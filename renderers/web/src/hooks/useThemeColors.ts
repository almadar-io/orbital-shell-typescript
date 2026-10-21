import { useLayoutEffect, useState, type RefObject } from 'react';
import { useTheme, useThemeScope } from '../core';
import { resolveThemeColor, type ResolvedColor } from '../lib/theme-color';

/**
 * Resolve a map of theme color expressions to concrete sRGB values inside
 * `scopeRef`, re-resolving whenever the applied or subtree theme changes. For three.js
 * and canvas surfaces only — SVG/DOM should use the expressions directly.
 * Returns null until the scope element is mounted.
 */
export function useThemeColors<K extends string>(
  values: Readonly<Record<K, string>>,
  scopeRef: RefObject<Element | null>,
): Readonly<Record<K, ResolvedColor | null>> | null {
  const { appliedTheme } = useTheme();
  const scopeKey = JSON.stringify(useThemeScope());
  const [resolved, setResolved] = useState<Readonly<Record<K, ResolvedColor | null>> | null>(null);
  const valuesKey = JSON.stringify(values);

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    const out = {} as Record<K, ResolvedColor | null>;
    for (const key of Object.keys(values) as K[]) out[key] = resolveThemeColor(values[key], scope);
    setResolved(out);
    // values is captured by its serialized key.
  }, [appliedTheme, scopeKey, valuesKey, scopeRef]);

  return resolved;
}
