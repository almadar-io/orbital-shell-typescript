'use client';
/**
 * BloomQuizBlock Molecule Component
 *
 * Practice Q&A with Bloom's Taxonomy level badge. Emits `UI:ANSWER_BLOOM { index, level }`.
 *
 * Event Contract:
 * - Emits: UI:ANSWER_BLOOM { index, level }
 * - entityAware: false
 */

import type { A11yProps } from '@almadar/core';
import React, { useState, useMemo } from 'react';
import { CheckCircle } from 'lucide-react';
import { MarkdownContent } from './markdown/MarkdownContent';
import { CodeBlock } from './markdown/CodeBlock';
import { parseMarkdownWithCodeBlocks } from '../../../lib/lessonSegmentUtils';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';
import type { CodeLanguage } from './markdown/CodeBlock';

import { domPassthrough } from '../../../core';
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

const BLOOM_CONFIG: Record<BloomLevel, { color: string; bgColor: string; labelKey: string }> = {
  remember:   { color: 'bg-secondary text-secondary-foreground', bgColor: 'bg-muted',     labelKey: 'bloomQuiz.level.remember' },
  understand: { color: 'bg-info text-info-foreground',           bgColor: 'bg-info/10',   labelKey: 'bloomQuiz.level.understand' },
  apply:      { color: 'bg-success text-success-foreground',     bgColor: 'bg-success/10', labelKey: 'bloomQuiz.level.apply' },
  analyze:    { color: 'bg-warning text-warning-foreground',     bgColor: 'bg-warning/10', labelKey: 'bloomQuiz.level.analyze' },
  evaluate:   { color: 'bg-accent text-accent-foreground',       bgColor: 'bg-accent/10', labelKey: 'bloomQuiz.level.evaluate' },
  create:     { color: 'bg-primary text-primary-foreground',     bgColor: 'bg-primary/10', labelKey: 'bloomQuiz.level.create' },
};

export interface BloomQuizBlockProps extends A11yProps {
  level: BloomLevel;
  question: string;
  answer: string;
  /** Zero-based index (used in the emitted event payload) */
  index?: number;
  /** Whether the learner has already answered */
  isAnswered?: boolean;
  /** Event name emitted on first reveal (as `UI:<answerEvent>`). Defaults to 'ANSWER_BLOOM'. */
  answerEvent?: string;
  /** Additional CSS classes */
  className?: string;
}

export const BloomQuizBlock: React.FC<BloomQuizBlockProps> = ({
  level,
  question,
  answer,
  index,
  isAnswered,
  answerEvent = 'ANSWER_BLOOM',
  className,
  ...rest
}) => {
  const [revealed, setRevealed] = useState(false);
  const config = BLOOM_CONFIG[level];
  const { emit } = useEventBus();
  const { t } = useTranslate();

  const questionSegments = useMemo(() => parseMarkdownWithCodeBlocks(question), [question]);
  const answerSegments = useMemo(() => parseMarkdownWithCodeBlocks(answer), [answer]);

  const handleReveal = () => {
    if (!revealed) {
      emit(`UI:${answerEvent}`, { index: index ?? 0, level });
    }
    setRevealed(!revealed);
  };

  return (
    <div
      {...domPassthrough(rest)}
      className={cn(
        'rounded-container border border-primary p-4 my-4 transition-all',
        config.bgColor,
        className,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {index !== undefined && (
            <span className="text-muted-foreground font-medium text-sm">
              {t('bloomQuiz.question', { number: index + 1 })}
            </span>
          )}
          <span className={cn(config.color, 'text-xs px-2 py-1 rounded-full font-medium')}>
            {t(config.labelKey)}
          </span>
        </div>
        {isAnswered && (
          <CheckCircle className="text-success flex-shrink-0" size={20} />
        )}
      </div>

      <div className="font-semibold text-primary mb-3 space-y-2">
        {questionSegments.map((segment, idx) =>
          segment.type === 'markdown' ? (
            <MarkdownContent key={`q-md-${idx}`} content={segment.content} />
          ) : (
            <CodeBlock
              key={`q-code-${idx}`}
              language={(segment.language ?? 'text') as CodeLanguage}
              code={segment.content}
            />
          ),
        )}
      </div>

      <button
        type="button"
        className="inline-flex items-center rounded-interactive bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors"
        onClick={handleReveal}
      >
        {revealed ? t('bloomQuiz.hideAnswer') : t('bloomQuiz.revealAnswer')}
      </button>

      {revealed && (
        <div className="rounded-container bg-card/80 p-3 text-sm text-foreground shadow-elevation-card surface-material border border-primary mt-3 space-y-2">
          <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">
            {t('bloomQuiz.answer')}
          </div>
          {answerSegments.map((segment, idx) =>
            segment.type === 'markdown' ? (
              <MarkdownContent key={`a-md-${idx}`} content={segment.content} />
            ) : (
              <CodeBlock
                key={`a-code-${idx}`}
                language={(segment.language ?? 'text') as CodeLanguage}
                code={segment.content}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
};

BloomQuizBlock.displayName = 'BloomQuizBlock';
