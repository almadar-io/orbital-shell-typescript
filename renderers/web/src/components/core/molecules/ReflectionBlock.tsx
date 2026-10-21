'use client';
/**
 * ReflectionBlock Molecule Component
 *
 * Inline reflection prompt for deep processing. Emits `UI:SAVE_REFLECTION { index, note }`.
 *
 * Event Contract:
 * - Emits: UI:SAVE_REFLECTION { index, note }
 * - entityAware: false
 */

import type { A11yProps } from '@almadar/core';
import React, { useState } from 'react';
import { PauseCircle } from 'lucide-react';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';

import { domPassthrough } from '../../../core';
export interface ReflectionBlockProps extends A11yProps {
  /** The reflection prompt */
  prompt: string;
  /** Zero-based index of this block (used in the emitted event payload) */
  index: number;
  /** Pre-filled note from saved state */
  savedNote?: string;
  /** Event name emitted on save (as `UI:<saveEvent>`). Defaults to 'SAVE_REFLECTION'. */
  saveEvent?: string;
  /** Additional CSS classes */
  className?: string;
}

export const ReflectionBlock: React.FC<ReflectionBlockProps> = ({
  prompt,
  index,
  savedNote,
  saveEvent = 'SAVE_REFLECTION',
  className,
  ...rest
}) => {
  const [note, setNote] = useState(savedNote ?? '');
  const [isExpanded, setIsExpanded] = useState(false);
  const { emit } = useEventBus();
  const { t } = useTranslate();

  const handleSave = () => {
    emit(`UI:${saveEvent}`, { index, note });
    setIsExpanded(false);
  };

  return (
    <div
      {...domPassthrough(rest)}
      className={cn(
        'my-6 border-l-heavy border-warning bg-warning/10 rounded-r-container p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <PauseCircle className="text-warning flex-shrink-0 mt-1" size={20} />
        <div className="flex-1">
          <div className="font-medium text-warning mb-2">{t('reflection.title')}</div>
          <p className="text-foreground text-sm mb-3">{prompt}</p>

          {isExpanded ? (
            <>
              <textarea
                className="w-full p-2 border border-input rounded-interactive text-sm bg-card text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                placeholder={t('reflection.placeholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
              <button
                onClick={handleSave}
                className="mt-2 text-sm px-3 py-1 bg-warning text-warning-foreground rounded-interactive hover:opacity-90 transition-colors"
              >
                {t('reflection.saveContinue')}
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsExpanded(true)}
              className="text-sm text-warning hover:underline"
            >
              {savedNote ? t('reflection.answeredEdit') : t('reflection.answerQuestion')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

ReflectionBlock.displayName = 'ReflectionBlock';
