/**
 * Icon Atom Component
 *
 * Renders an icon from the active icon family (Layer 1 Iconography axis —
 * see lib/iconFamily.ts). Canonical names are lucide kebab-case; the resolver
 * dispatches to phosphor / tabler / fa-solid when `--icon-family` selects them,
 * re-rendering automatically on theme switch.
 *
 * Supports two APIs:
 * - `icon` prop: Pass a LucideIcon component directly (bypasses family resolver
 *   — used for direct lucide component refs, stays in lucide regardless of theme)
 * - `name` prop: Pass a canonical kebab-case name (family-aware, swaps on theme)
 */

'use client';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { HelpCircle } from 'lucide-react';
import { resolveLucideByName } from '../lib/lucideIcons';
import { cn } from '../lib/cn';
import { resolveIconForFamily, useIconFamily, useThemeIconStrokeApplies } from '../lib/iconFamily';
import type { ColorToken } from './types';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type IconAnimation = 'spin' | 'pulse' | 'none';
export type { ColorToken };

/**
 * Canonical icon-input type: a Lucide component reference OR a canonical
 * kebab-case icon name string. The single source of truth for every
 * icon-bearing prop across `@almadar/ui` — pattern-sync's parser maps this
 * union to the `icon` config type, so the factory inspector renders an
 * IconPicker and a string name resolves via `resolveIcon`. Never declare an
 * icon prop as `React.ReactNode` (it collapses to a non-editable `node`).
 */
export type IconInput = LucideIcon | string;

const colorTokenClasses: Record<ColorToken, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  muted: 'text-muted-foreground',
};

/** Cache resolved icons to avoid repeated lookups */
const resolvedCache = new Map<string, LucideIcon>();

/**
 * Resolve an icon name to a Lucide icon component.
 * Supports all 1500+ Lucide icons by kebab-case or PascalCase name; each icon loads on demand.
 * Falls back to the help glyph if not found.
 */
export function resolveIcon(name: string): LucideIcon {
  const cached = resolvedCache.get(name);
  if (cached) return cached;

  const resolved = resolveLucideByName(name);
  resolvedCache.set(name, resolved);
  return resolved;
}

export interface IconProps extends A11yProps {
  /**
   * Lucide icon component (preferred for type-safe usage), OR a canonical
   * kebab-case icon name string — a string is treated exactly like `name` so
   * trait/factory authors can pass an icon by name through the `icon` prop.
   */
  icon?: IconInput;
  /** Icon name as string (resolved from iconMap) */
  name?: string;
  /** Size of the icon */
  size?: IconSize;
  /** Semantic palette token or an arbitrary Tailwind color class. */
  color?: ColorToken | string;
  /** Animation type */
  animation?: IconAnimation;
  /** Additional CSS classes */
  className?: string;
  /** Icon stroke width - uses theme default if not specified */
  strokeWidth?: number;
  /** Inline style */
  style?: React.CSSProperties;
}

const sizeClasses: Record<IconSize, string> = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'h-icon-default w-icon-default',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8',
};

const animationClasses: Record<IconAnimation, string> = {
  none: '',
  spin: 'animate-spin',
  pulse: 'animate-pulse',
};

export const Icon: React.FC<IconProps> = ({
  icon,
  name,
  size = 'md',
  color,
  animation = 'none',
  className,
  strokeWidth,
  style,
  ...rest
}) => {
  // The `icon` prop bypasses the family resolver (caller already chose a specific
  // component reference, usually a direct lucide import). The `name` prop dispatches
  // through useIconFamily so the icon swaps families when the user changes theme.
  // A string `icon` is an icon NAME, not a component — route it through the
  // family-aware `name` path so it resolves (and theme-swaps) like `name`.
  const directIcon: LucideIcon | undefined =
    typeof icon === "string" ? undefined : icon;
  // Empty-string `icon` counts as unset so `name` still resolves — ui-icon's
  // config forwards both props and its neutral default must not shadow `name`.
  const effectiveName = typeof icon === "string" && icon !== "" ? icon : name;
  // 0 counts as unset for the same reason: ui-icon's neutral `strokeWidth`
  // default is 0, and a literal 0 would zero the stroke and hide the icon.
  const effectiveStrokeWidth = strokeWidth != null && strokeWidth > 0 ? strokeWidth : undefined;
  const family = useIconFamily();
  const svgRef = React.useRef<SVGSVGElement>(null);
  const themeStroke = useThemeIconStrokeApplies(svgRef);
  const RenderedComponent = React.useMemo(() => {
    if (directIcon) return null;
    return effectiveName ? resolveIconForFamily(effectiveName, family) : null;
  }, [directIcon, effectiveName, family]);

  const inlineStyle: React.CSSProperties = {
    ...(effectiveStrokeWidth === undefined && themeStroke
      ? { strokeWidth: 'var(--icon-stroke-width, 2)' }
      : {}),
    ...style,
  };
  const resolvedColor = color
    ? (color in colorTokenClasses
        ? colorTokenClasses[color as ColorToken]
        : color)
    : 'text-current';
  const composedClassName = cn(
    sizeClasses[size],
    animationClasses[animation],
    resolvedColor,
    className,
  );

  if (directIcon) {
    const Direct = directIcon;
    return (
      <Direct
        ref={svgRef}
        className={composedClassName}
        strokeWidth={effectiveStrokeWidth}
        style={inlineStyle}
        {...domPassthrough(rest)}
      />
    );
  }
  if (RenderedComponent) {
    return (
      <RenderedComponent
        ref={svgRef}
        className={composedClassName}
        strokeWidth={effectiveStrokeWidth}
        style={inlineStyle}
        {...domPassthrough(rest)}
      />
    );
  }
  // Last-resort fallback if neither icon nor name was passed.
  const Fallback = HelpCircle;
  return (
    <Fallback
      ref={svgRef}
      className={composedClassName}
      strokeWidth={effectiveStrokeWidth}
      style={inlineStyle}
      {...domPassthrough(rest)}
    />
  );
};

Icon.displayName = 'Icon';
