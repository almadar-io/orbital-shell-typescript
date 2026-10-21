import * as React from "react";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Card } from '../../../core';
import { StatBadge, type StatBadgeProps } from "./StatBadge";
import type { A11yProps, Asset } from "@almadar/core";
import { domPassthrough } from '../../../core';
import type { IconInput } from '../../../core';
import { useTranslate, type TranslateFunction } from '../../../core';

export interface GameHudStat extends Omit<StatBadgeProps, "size"> {
  /** Data source entity name */
  source?: string;
  /** Field name in the source */
  field?: string;
}

/**
 * Schema-style HUD element definition.
 * Used when elements are passed from schema render_ui effects.
 */
export interface GameHudElement {
  type?: string;
  bind?: string;
  position?: string;
  label?: string;
  /** Direct value (from compiled render-ui effects) */
  value?: number | string;
  /** Lucide icon name or component */
  icon?: IconInput;
  assetUrl?: Asset;
  /** Display format */
  format?: string;
  /** Max value (for bars/hearts) */
  max?: number;
}

export interface GameHudProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Position of the HUD */
  position?: "top" | "bottom" | "corners" | string;
  /** Stats to display - accepts readonly for compatibility with generated const arrays */
  stats?: readonly GameHudStat[];
  /** Alias for stats (schema compatibility) */
  items?: readonly GameHudStat[];
  /**
   * Schema-style elements array (alternative to stats).
   * Converted to stats internally for backwards compatibility.
   */
  elements?: readonly GameHudElement[];
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /**
   * Layout variant: "floating" (default) renders a compact pill cluster that hugs
   * its content width; "bar" preserves the legacy full-width split bar.
   */
  variant?: "floating" | "bar";
  /** Additional CSS classes */
  className?: string;
  /** Whether to use a semi-transparent background */
  transparent?: boolean;
}

const positionMap: Record<string, string> = {
  corners: "inset-0 pointer-events-none",
};

/**
 * Convert schema-style elements to GameHudStat format.
 */
const ELEMENT_LABEL_KEYS: Record<string, string> = {
  "health-bar": "gameHud.health",
  "score-display": "gameHud.score",
  lives: "gameHud.lives",
  timer: "gameHud.time",
};

function convertElementsToStats(
  elements: readonly GameHudElement[],
  t: TranslateFunction,
): GameHudStat[] {
  return elements.map((el) => {
    // Parse bind format: "entity.field" -> source + field
    const [source, field] = el.bind?.split(".") ?? [];

    return {
      label: el.label || (ELEMENT_LABEL_KEYS[el.type ?? ""] ? t(ELEMENT_LABEL_KEYS[el.type ?? ""]) : el.type) || "",
      source,
      field,
      // Pass through direct values from compiled render-ui effects
      ...(el.value !== undefined && { value: el.value }),
      ...(el.icon !== undefined && { icon: el.icon }),
      ...(el.assetUrl !== undefined && { assetUrl: el.assetUrl }),
      ...(el.format !== undefined && { format: el.format }),
      ...(el.max !== undefined && { max: el.max }),
    };
  });
}

const DEFAULT_HUD_STATS: ReadonlyArray<Omit<GameHudStat, 'label'> & { labelKey: string }> = [
  { labelKey: 'gameHud.hp', value: 75, max: 100, format: 'bar', variant: 'danger' },
  { labelKey: 'gameHud.mp', value: 40, max: 60, format: 'bar', variant: 'primary' },
  { labelKey: 'gameHud.score', value: 4200, format: 'number', variant: 'warning' },
  { labelKey: 'gameHud.level', value: 4, format: 'number', variant: 'default' },
];

export function GameHud({
  position: propPosition,
  stats: propStats,
  items,
  elements,
  size = "md",
  variant = "floating",
  className,
  transparent = true,
  ...rest
}: GameHudProps) {
  // Convert elements to stats if provided, with items as alias for stats
  // Defensive: ensure stats is always a valid array even if props are malformed
  const { t } = useTranslate();
  const defaultStats: GameHudStat[] = DEFAULT_HUD_STATS.map(({ labelKey, ...rest }) => ({ ...rest, label: t(labelKey) }));
  const rawStats =
    propStats ?? items ?? (elements && Array.isArray(elements) ? convertElementsToStats(elements, t) : defaultStats);
  const stats = Array.isArray(rawStats) ? rawStats : [];

  // Determine position from props or derive from elements
  const position = propPosition ?? "top";

  if (position === "corners") {
    // Split stats between corners
    const leftStats = stats.slice(0, Math.ceil(stats.length / 2));
    const rightStats = stats.slice(Math.ceil(stats.length / 2));

    return (
      <Box {...domPassthrough(rest)} position="relative" className={cn(positionMap[position], className)}>
        {/* Top-left */}
        <Box position="absolute" className="top-4 left-4 flex flex-col gap-2 pointer-events-auto">
          {leftStats.map((stat, i) => (
            <StatBadge key={i} {...stat} size={size} />
          ))}
        </Box>

        {/* Top-right */}
        <Box position="absolute" className="top-4 right-4 flex flex-col gap-2 items-end pointer-events-auto">
          {rightStats.map((stat, i) => (
            <StatBadge key={i} {...stat} size={size} />
          ))}
        </Box>
      </Box>
    );
  }

  if ((position === "top" || position === "bottom") && variant === "bar") {
    // Legacy full-width split bar (opt-in via variant="bar").
    // Split stats into left (first half) and right (second half) groups
    const mid = Math.ceil(stats.length / 2);
    const leftStats = stats.slice(0, mid);
    const rightStats = stats.slice(mid);

    return (
      <Card
        {...domPassthrough(rest)}
        variant="bordered"
        padding="none"
        className={cn(
          "flex items-center justify-between w-full rounded-none bg-card",
          "px-4 py-2 gap-4",
          transparent && "backdrop-blur-sm",
          className,
        )}
        style={transparent ? { backgroundColor: "color-mix(in srgb, var(--color-card) 40%, transparent)" } : undefined}
      >
        {/* Left stat group */}
        <Box className="flex items-center gap-3 flex-shrink-0">
          {leftStats.map((stat, i) => (
            <StatBadge key={i} {...stat} size={size} />
          ))}
        </Box>
        {/* Right stat group */}
        {rightStats.length > 0 && (
          <Box className="flex items-center gap-3 flex-shrink-0">
            {rightStats.map((stat, i) => (
              <StatBadge key={i} {...stat} size={size} />
            ))}
          </Box>
        )}
      </Card>
    );
  }

  return (
    <Card
      {...domPassthrough(rest)}
      variant="bordered"
      padding="sm"
      className={cn(
        "z-10 relative flex items-center gap-4 bg-card",
        transparent && "backdrop-blur-sm",
        className,
      )}
      style={transparent ? { backgroundColor: "color-mix(in srgb, var(--color-card) 30%, transparent)" } : undefined}
    >
      {stats.map((stat, i) => (
        <StatBadge key={i} {...stat} size={size} />
      ))}
    </Card>
  );
}

GameHud.displayName = "GameHud";
