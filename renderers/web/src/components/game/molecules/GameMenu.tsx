'use client';
import * as React from "react";
import type { A11yProps, EventKey, EventPayload, Asset } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { Card } from '../../../core';
import { Typography } from '../../../core';
import { GameIcon } from '../../../core';
import { ChoiceButton } from "../atoms/ChoiceButton";

export type MenuOption = EventPayload & {
  /** Optional ID (generated from index if not provided) */
  id?: string;
  /** Display label */
  label: string;
  /** Event to emit on click */
  event?: EventKey;
  /** Page to navigate to */
  navigatesTo?: string;
  /** Button variant */
  variant?: "primary" | "secondary" | "ghost" | string;
  /** Whether the option is disabled */
  disabled?: boolean;
  /** Sub-label or description */
  subLabel?: string;
}

export interface GameMenuProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Menu title */
  title: string;
  /** Optional subtitle or version */
  subtitle?: string;
  /** Menu options - accepts readonly for compatibility with generated const arrays */
  options?: readonly MenuOption[];
  /** Alias for options (schema compatibility) */
  menuItems?: readonly MenuOption[];
  /** Called when an option is selected (legacy callback, prefer event bus) */
  onSelect?: (option: MenuOption) => void;
  /** Background image or gradient */
  background?: string;
  /** Logo asset */
  logo?: Asset;
  /** Additional CSS classes */
  className?: string;
}

/** True inside `GameShell`'s overlay layer: the menu is a banner over the arena, not a full screen. */
export const GameOverlayContext = React.createContext(false);

const DEFAULT_MENU_OPTION_KEYS: ReadonlyArray<{ labelKey: string; event: EventKey; variant: string }> = [
  { labelKey: 'gameMenu.newGame', event: 'NEW_GAME', variant: 'primary' },
  { labelKey: 'gameMenu.continue', event: 'CONTINUE', variant: 'secondary' },
  { labelKey: 'gameMenu.settings', event: 'SETTINGS', variant: 'ghost' },
];

export function GameMenu({
  title: titleProp,
  subtitle,
  options,
  menuItems,
  onSelect,
  background,
  logo,
  className,
  ...rest
}: GameMenuProps) {
  // Resolve alias: menuItems → options. Empty arrays count as unset (the
  // ui-game-menu atom always forwards both config fields, defaulting to []).
  const { t } = useTranslate();
  const title = titleProp ?? t('gameMenu.defaultTitle');
  const defaultOptions: MenuOption[] = DEFAULT_MENU_OPTION_KEYS.map((o) => ({
    label: t(o.labelKey),
    event: o.event,
    variant: o.variant,
  }));
  const resolvedOptions = (options?.length ? options : undefined) ?? (menuItems?.length ? menuItems : undefined) ?? defaultOptions;

  const eventBus = useEventBus();
  const inOverlay = React.useContext(GameOverlayContext);

  const handleOptionClick = React.useCallback(
    (option: MenuOption) => {
      // Emit event to event bus for closed circuit pattern
      if (option.event) {
        eventBus.emit(`UI:${option.event}`, { option });
      }

      // Call legacy callback if provided
      if (onSelect) {
        onSelect(option);
      }

      // Handle navigation if navigatesTo is specified
      if (option.navigatesTo) {
        eventBus.emit('UI:NAVIGATE', { url: option.navigatesTo, option });
      }
    },
    [eventBus, onSelect],
  );

  return (
    <Box
      {...domPassthrough(rest)}
      data-game-menu=""
      className={cn(
        inOverlay
          ? "flex flex-col items-center justify-center"
          : "min-h-screen w-full flex flex-col items-center justify-center p-8",
        !background && !inOverlay && "bg-background",
        className,
      )}
      style={background ? { background } : undefined}
    >
      <Card
        variant="bordered"
        padding="lg"
        className="bg-card flex flex-col items-center max-w-md w-full"
      >
        {/* Logo/Title Section */}
        <Box className="text-center mb-8 animate-fade-in">
          {logo && (
            <GameIcon assetUrl={logo} icon="image" size={96} alt={title} className="h-24 w-auto mx-auto mb-6 drop-shadow-2xl" />
          )}
          <Typography
            variant="h1"
            className="text-4xl md:text-5xl text-foreground tracking-tight"
            style={{
              textShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body" className="mt-2 text-lg text-muted-foreground tracking-widest uppercase">
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Menu Options */}
        <Box className="flex flex-col gap-4 w-full">
          {resolvedOptions.map((option, index) => (
            <ChoiceButton
              key={index}
              text={option.label}
              index={index + 1}
              disabled={option.disabled}
              onClick={() => handleOptionClick(option)}
              className="text-lg py-4 px-8"
            />
          ))}
        </Box>
      </Card>

      {/* Decorative Elements */}
      <Box position="absolute" className="inset-0 pointer-events-none overflow-hidden -z-10">
        <Box position="absolute" className="top-1/4 left-1/4 w-64 h-64 bg-info/10 rounded-container blur-3xl" />
        <Box position="absolute" className="bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-container blur-3xl" />
      </Box>
    </Box>
  );
}

GameMenu.displayName = "GameMenu";
