/**
 * QuizBlock Molecule Component
 *
 * A collapsible Q&A block for embedded quiz questions in content.
 * Shows the question with a reveal button for the answer.
 *
 * Event Contract:
 * - No events emitted (self-contained interaction)
 * - entityAware: false
 */

import type { A11yProps } from '@almadar/core';
import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Card } from './Card';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import { Box } from '../../../core';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';

import { domPassthrough } from '../../../core';
/**
 * QuizBlock — a single quiz question with answer choices and submit/reveal
 * feedback.
 *
 * @capabilities multiple-choice quiz, test question, exam item, assessment question, knowledge check, trivia question
 */
export interface QuizBlockProps extends A11yProps {
  /** The quiz question */
  question: string;
  /** The quiz answer (revealed on toggle) */
  answer: string;
  /** Additional CSS classes */
  className?: string;
}

export const QuizBlock: React.FC<QuizBlockProps> = ({
  question,
  answer,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const [revealed, setRevealed] = useState(false);

  return (
    <Card {...domPassthrough(rest)} className={cn('my-4 border-primary', className)}>
      <VStack gap="sm" className="p-4">
        <HStack gap="sm" align="start">
          <Icon icon={HelpCircle} size="sm" className="text-primary mt-0.5 shrink-0" />
          <Typography variant="body" className="font-medium">
            {question}
          </Typography>
        </HStack>

        {revealed ? (
          <Box className="pl-7 pt-2 border-t border-border">
            <Typography variant="body" className="text-foreground">
              {answer}
            </Typography>
          </Box>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRevealed((r) => !r)}
          className="self-start ml-7"
        >
          <HStack gap="xs" align="center">
            <Typography variant="caption">
              {revealed ? t('quiz.hideAnswer') : t('quiz.showAnswer')}
            </Typography>
            {revealed ? <Icon name="chevron-up" className="w-3.5 h-3.5" /> : <Icon name="chevron-down" className="w-3.5 h-3.5" />}
          </HStack>
        </Button>
      </VStack>
    </Card>
  );
};

QuizBlock.displayName = 'QuizBlock';
