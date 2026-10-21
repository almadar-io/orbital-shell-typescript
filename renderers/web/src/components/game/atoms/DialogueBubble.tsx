import * as React from 'react';
import type { A11yProps, Asset } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { GameIcon } from '../../../core';
import { useTranslate } from '../../../core';

const DEFAULT_PORTRAIT: Asset = {
  url: 'https://almadar-kflow-assets.web.app/shared/ui-winter-ski-board/default/units/hero/hero.png',
  role: 'effect',
  category: 'character',
};

/** Portrait-ring accent per mood — a plain CSS-driven pose, same idiom as `HealthBar.animated`. */
const MOOD_RING_CLASS: Record<string, string> = {
  neutral: 'border-warning/60',
  happy: 'border-success/70',
  concerned: 'border-info/70',
  angry: 'border-error/70',
};

export interface DialogueBubbleProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Speaker name displayed at the top */
  speaker?: string;
  /** Dialogue text content */
  text: string;
  /** Speaker portrait asset */
  portrait?: Asset;
  /** Position of the bubble on screen */
  position?: 'top' | 'bottom';
  /** Speaker mood — drives a portrait-ring accent; LOLO sets this per dialogue node/transition. */
  mood?: 'neutral' | 'happy' | 'concerned' | 'angry';
  /**
   * Number of `text` characters to reveal (typewriter effect). Omit to show
   * the full string — LOLO drives this from `@entity.revealedChars` via a
   * tick, incrementing it until it reaches `text.length`.
   */
  revealedChars?: number;
  /** Additional CSS classes */
  className?: string;
}

export function DialogueBubble({
  speaker: speakerProp,
  text: textProp,
  portrait = DEFAULT_PORTRAIT,
  position = 'bottom',
  mood = 'neutral',
  revealedChars,
  className,
  ...rest
}: DialogueBubbleProps) {
  const { t } = useTranslate();
  const speaker = speakerProp ?? t('dialogueBubble.defaultSpeaker');
  const text = textProp ?? t('dialogueBubble.defaultText');
  const visibleText = revealedChars === undefined ? text : text.slice(0, revealedChars);

  return (
    <Box
      {...domPassthrough(rest)}
      className={cn(
        'flex items-start gap-3 rounded-container bg-background/80 backdrop-blur-sm px-4 py-3 border border-border/10',
        position === 'top' ? 'rounded-bl-none' : 'rounded-tl-none',
        className
      )}
    >
      {portrait && (
        <Box className={cn('flex-shrink-0 w-12 h-12 rounded-full overflow-hidden border-heavy transition-colors duration-300', MOOD_RING_CLASS[mood])}>
          <GameIcon assetUrl={portrait} icon="image" size={48} alt={speaker} className="w-full h-full object-cover" />
        </Box>
      )}
      <Box className="flex flex-col gap-1 min-w-0">
        {speaker && (
          <Typography as="span" className="text-sm font-bold text-warning">
            {speaker}
          </Typography>
        )}
        <Typography as="span" className="text-sm text-foreground leading-relaxed">
          {visibleText}
        </Typography>
      </Box>
    </Box>
  );
}

DialogueBubble.displayName = 'DialogueBubble';
