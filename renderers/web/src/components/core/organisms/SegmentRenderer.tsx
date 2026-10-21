'use client';
/**
 * SegmentRenderer Organism Component
 *
 * Renders a parsed array of LessonSegments — markdown, code, quizzes,
 * activation prompts, connections, reflections, Bloom questions.
 * The `visualization` segment type is passed through as a no-op unless the
 * caller provides `onRenderVisualization` (future extensibility hook).
 *
 * Event Contract:
 * - Delegates to child molecules: UI:{activationSaveEvent|SAVE_ACTIVATION}, UI:{reflectionSaveEvent|SAVE_REFLECTION}, UI:{bloomAnswerEvent|ANSWER_BLOOM}
 * - Emits (selection / highlights): UI:{askEvent} { selectedText }, UI:{noteEvent} { selectedText }, UI:{annotationEvent} { annotationId }
 * - entityAware: false
 */

import React, { useMemo } from 'react';
import { MarkdownContent } from '../molecules/markdown/MarkdownContent';
import { CodeBlock } from '../molecules/markdown/CodeBlock';
import { MermaidDiagram } from '../molecules/markdown/MermaidDiagram';
import { QuizBlock } from '../molecules/QuizBlock';
import { ActivationBlock } from '../molecules/ActivationBlock';
import { ConnectionBlock } from '../molecules/ConnectionBlock';
import { ReflectionBlock } from '../molecules/ReflectionBlock';
import { BloomQuizBlock, type BloomLevel } from '../molecules/BloomQuizBlock';
import { SelectionAnnotator } from '../molecules/markdown/SelectionAnnotator';
import type { ContentAnnotation } from '../../../lib/content-annotations';
import { CodeRunnerPanel, type CodeSimulationOutput } from './CodeRunnerPanel';
import { cn } from '../../../core';
import type { A11yProps, EventEmit } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { parseLessonSegments } from '../../../lib/parseLessonSegments';

export type { CodeSimulationOutput };

export type InteractiveOrbitalType =
  | 'algorithms'
  | 'math'
  | 'physics'
  | 'biology'
  | 'chemistry'
  | 'probability';

export type LessonSegment =
  | { type: 'markdown'; content: string }
  | { type: 'code'; language: string; content: string; runnable?: boolean }
  | { type: 'quiz'; question: string; answer: string }
  | { type: 'activate'; question: string }
  | { type: 'connect'; content: string }
  | { type: 'reflect'; prompt: string }
  | { type: 'bloom'; level: BloomLevel; question: string; answer: string }
  | { type: 'visualization'; visualizationType: InteractiveOrbitalType; description: string };

/**
 * User progress state passed into SegmentRenderer. Declared here (rather than
 * alongside `LessonSegment` in `lib/parseLessonSegments.ts`) so the
 * pattern-sync scanner — which only indexes types under `components/**` —
 * can resolve it to a concrete `.lolo` object shape instead of `json`.
 */
export interface LessonUserProgress {
  activationResponse?: string;
  reflectionNotes?: string[];
  bloomAnswered?: Record<number, boolean>;
}

export interface SegmentRendererProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Parsed lesson segments (see `parseLessonSegments`). Ignored when `lesson` is given. */
  segments?: LessonSegment[];
  /** Raw lesson markdown with learning tags; parsed with `parseLessonSegments` and rendered */
  lesson?: string;
  /** Event emitted when the activation prompt is saved or skipped (as `UI:<activationSaveEvent>`) */
  activationSaveEvent?: EventEmit<{ response: string }>;
  /** Event emitted when a reflection note is saved (as `UI:<reflectionSaveEvent>`) */
  reflectionSaveEvent?: EventEmit<{ index: number; note: string }>;
  /** Event emitted on the first reveal of a Bloom question (as `UI:<bloomAnswerEvent>`) */
  bloomAnswerEvent?: EventEmit<{ index: number; level: BloomLevel }>;
  /** Event emitted when the reader picks Ask on selected text (as `UI:<askEvent>`) */
  askEvent?: EventEmit<{ selectedText: string }>;
  /** Event emitted when the reader picks Note on selected text (as `UI:<noteEvent>`) */
  noteEvent?: EventEmit<{ selectedText: string }>;
  /** Ask action label (default: translated) */
  askLabel?: string;
  /** Note action label (default: translated) */
  noteLabel?: string;
  /**
   * Passages to highlight. Each `text` is matched exactly against the markdown
   * segments, first segment whose source contains it, first occurrence inside one
   * rendered text node (outside code); one that spans formatting is not highlighted.
   */
  annotations?: ContentAnnotation[];
  /** Event emitted when a highlighted passage is clicked (as `UI:<annotationEvent>`) */
  annotationEvent?: EventEmit<{ annotationId?: string }>;
  /** Additional CSS classes for the root container */
  className?: string;
  /** CSS classes for the outer wrapping div */
  containerClassName?: string;
  /** User progress for restoring activation/reflection state */
  userProgress?: LessonUserProgress;
  /**
   * Event a runnable code block emits on Run (`{ code, language, runId }`, runId = the segment
   * index). Omit to render runnable blocks read-only.
   */
  runCodeEvent?: EventEmit<{ code: string; language: string; runId: string }>;
  /** Event a runnable code block emits on Reset (`{ runId }`). */
  resetCodeEvent?: EventEmit<{ runId: string }>;
  /** The program's run results, keyed by segment runId. */
  codeOutputs?: Record<string, CodeSimulationOutput>;
  /** The runId the program is currently running. */
  runningCode?: string;
  /**
   * Optional render slot for `visualization` segment types. When not provided,
   * visualization segments are silently skipped. Callers can wire this to any
   * custom component or orbital generator.
   */
  onRenderVisualization?: (type: InteractiveOrbitalType, description: string, index: number) => React.ReactNode;
}

export const SegmentRenderer: React.FC<SegmentRendererProps> = ({
  segments: segmentsProp,
  lesson,
  activationSaveEvent,
  reflectionSaveEvent,
  bloomAnswerEvent,
  askEvent,
  noteEvent,
  askLabel,
  noteLabel,
  annotations,
  annotationEvent,
  className,
  containerClassName,
  userProgress,
  runCodeEvent,
  resetCodeEvent,
  codeOutputs,
  runningCode,
  onRenderVisualization,
  ...rest
}) => {
  const segments = useMemo(
    () => (lesson !== undefined ? parseLessonSegments(lesson) : (segmentsProp ?? [])),
    [lesson, segmentsProp],
  );

  const annotationOwner = useMemo(() => {
    const owner = new Map<number, ContentAnnotation[]>();
    for (const annotation of annotations ?? []) {
      const at = segments.findIndex((s) => s.type === 'markdown' && s.content.includes(annotation.text));
      if (at >= 0) owner.set(at, [...(owner.get(at) ?? []), annotation]);
    }
    return owner;
  }, [annotations, segments]);

  if (segments.length === 0) return null;

  let reflectIndex = 0;
  let bloomIndex = 0;

  return (
    <SelectionAnnotator askEvent={askEvent} noteEvent={noteEvent} askLabel={askLabel} noteLabel={noteLabel}>
    <div
      {...domPassthrough(rest)}
      className={cn(
        'border border-border rounded-container p-2 md:p-4 overflow-x-auto space-y-6',
        containerClassName,
        className,
      )}
    >
      {segments.map((segment, index) => {
        if (segment.type === 'markdown') {
          return (
            <MarkdownContent
              key={`md-${index}`}
              content={segment.content}
              annotations={annotationOwner.get(index)}
              annotationEvent={annotationEvent}
            />
          );
        }

        if (segment.type === 'code') {
          if (segment.language === 'mermaid') {
            return <MermaidDiagram key={`code-${index}`} code={segment.content} />;
          }
          if (segment.runnable && runCodeEvent) {
            const runId = String(index);
            return (
              <CodeRunnerPanel
                key={`code-${index}`}
                language={segment.language}
                code={segment.content}
                runnable
                runEvent={runCodeEvent}
                resetEvent={resetCodeEvent}
                runId={runId}
                output={codeOutputs?.[runId] ?? null}
                running={runningCode === runId}
              />
            );
          }
          return (
            <CodeBlock
              key={`code-${index}`}
              language={segment.language ?? 'text'}
              code={segment.content}
            />
          );
        }

        if (segment.type === 'quiz') {
          return (
            <QuizBlock key={`quiz-${index}`} question={segment.question} answer={segment.answer} />
          );
        }

        if (segment.type === 'activate') {
          return (
            <ActivationBlock
              key={`activate-${index}`}
              question={segment.question}
              savedResponse={userProgress?.activationResponse}
              saveEvent={activationSaveEvent}
            />
          );
        }

        if (segment.type === 'connect') {
          return <ConnectionBlock key={`connect-${index}`} content={segment.content} />;
        }

        if (segment.type === 'reflect') {
          const ri = reflectIndex++;
          return (
            <ReflectionBlock
              key={`reflect-${index}`}
              prompt={segment.prompt}
              index={ri}
              savedNote={userProgress?.reflectionNotes?.[ri]}
              saveEvent={reflectionSaveEvent}
            />
          );
        }

        if (segment.type === 'bloom') {
          const bi = bloomIndex++;
          return (
            <BloomQuizBlock
              key={`bloom-${index}`}
              level={segment.level}
              question={segment.question}
              answer={segment.answer}
              index={bi}
              isAnswered={userProgress?.bloomAnswered?.[bi]}
              answerEvent={bloomAnswerEvent}
            />
          );
        }

        if (segment.type === 'visualization') {
          return onRenderVisualization
            ? (onRenderVisualization(segment.visualizationType, segment.description, index) ?? null)
            : null;
        }

        return null;
      })}
    </div>
    </SelectionAnnotator>
  );
};

SegmentRenderer.displayName = 'SegmentRenderer';
