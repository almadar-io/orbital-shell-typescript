/**
 * ContentRenderer Organism
 *
 * Renders rich content as a sequence of typed segments: markdown, code,
 * orbital diagrams (via JazariStateMachine), and quiz blocks. Accepts
 * either raw content string (auto-parsed) or pre-parsed segments.
 *
 * Event Contract:
 * - Delegates to child components (CodeBlock -> UI:COPY_CODE)
 * - entityAware: false
 */

import React, { useMemo } from 'react';
import { VStack } from '../../../core';
import { MarkdownContent } from './markdown/MarkdownContent';
import { CodeBlock, toCodeLanguage } from './markdown/CodeBlock';
import { QuizBlock } from './QuizBlock';
import { JazariStateMachine } from './JazariStateMachine';
import {
  parseContentSegments,
  type ContentSegment,
} from '../../../lib/parseContentSegments';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';
import type { DisplayStateProps } from '../organisms/types';
import type { OrbitalSchema, StateMachine, Trait, A11yProps } from '@almadar/core';

import { domPassthrough } from '../../../core';
type OrbitalOrMachine = OrbitalSchema | StateMachine;

export interface ContentRendererProps extends Omit<DisplayStateProps, keyof A11yProps>, A11yProps {
  /** Raw content string — auto-parsed into segments */
  content?: string;
  /** Pre-parsed segments (overrides content) */
  segments?: ContentSegment[];
  /** Text direction for markdown */
  direction?: 'rtl' | 'ltr';
}

export const ContentRenderer: React.FC<ContentRendererProps> = ({
  content,
  segments: segmentsProp,
  direction,
  className,
  ...rest
}) => {
  const { t: _t } = useTranslate();

  const segments = useMemo(
    () => segmentsProp ?? parseContentSegments(content),
    [segmentsProp, content],
  );

  if (segments.length === 0) return null;

  return (
    <VStack {...domPassthrough(rest)} gap="md" className={cn('w-full', className)}>
      {segments.map((segment, i) => {
        const key = `seg-${i}`;

        switch (segment.type) {
          case 'markdown':
            return (
              <MarkdownContent
                key={key}
                content={segment.content}
                direction={direction}
              />
            );

          case 'code':
            return (
              <CodeBlock
                key={key}
                code={segment.content}
                language={toCodeLanguage(segment.language)}
              />
            );

          case 'orbital': {
            // Normalize both bare traits ({states, transitions}) and full
            // schemas ({orbitals}) into a schema object so JazariStateMachine
            // always receives the same prop shape (the `schema` prop path).
            const parsed = segment.schema as OrbitalOrMachine;
            const isFullSchema = (v: OrbitalOrMachine): v is OrbitalSchema =>
              Array.isArray((v as OrbitalSchema).orbitals);
            const inlineTrait: Trait = {
              name: 'inline',
              stateMachine: parsed as StateMachine,
            };
            const schema: OrbitalSchema = isFullSchema(parsed)
              ? parsed
              : {
                  name: 'inline',
                  orbitals: [{
                    name: 'inline',
                    entity: { name: 'inline', fields: [] },
                    traits: [inlineTrait],
                    pages: [],
                  }],
                };
            return (
              <VStack key={key} gap="sm">
                <CodeBlock
                  code={segment.content}
                  language={toCodeLanguage(segment.language)}
                />
                <JazariStateMachine
                  schema={schema}
                  direction={direction}
                />
              </VStack>
            );
          }

          case 'quiz':
            return (
              <QuizBlock
                key={key}
                question={segment.question}
                answer={segment.answer}
              />
            );

          default:
            return null;
        }
      })}
    </VStack>
  );
};

ContentRenderer.displayName = 'ContentRenderer';
