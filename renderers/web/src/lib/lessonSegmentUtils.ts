/**
 * Utility for lesson-segment parsing: splits a markdown string into alternating
 * markdown and fenced-code-block segments. Exported so SegmentRenderer and
 * BloomQuizBlock can reuse without circular imports.
 */

import type { LessonSegment } from '../components/core/organisms/SegmentRenderer';

export type MarkdownSegment = Extract<LessonSegment, { type: 'markdown' }>;
export type CodeSegment = Extract<LessonSegment, { type: 'code' }>;
export type MixedSegment = MarkdownSegment | CodeSegment;

/** Splits markdown content into markdown and fenced-code-block segments. */
export function parseMarkdownWithCodeBlocks(content: string): MixedSegment[] {
  const segments: MixedSegment[] = [];
  // CommonMark-ish fenced code: ```<info-line>\r?\n<code>```. The info-line is
  // captured whole and tokenised below — the first token is the language, and
  // kflow adds a `run` token / `<lang>-runnable` suffix to mark executable
  // blocks. Capturing the full line (not just [\w-]) tolerates attributes like
  // ```ocaml title="x" and CRLF endings that previously left stray backticks.
  const codeBlockRegex = /```([^\n\r]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push({ type: 'markdown', content: before });
    }

    const tokens = match[1].trim().split(/\s+/).filter(Boolean);
    let rawLanguage = tokens[0] ?? 'text';
    const suffixRunnable = rawLanguage.endsWith('-runnable');
    const runnable = suffixRunnable || tokens.includes('run');
    const baseLanguage = suffixRunnable ? rawLanguage.slice(0, -'-runnable'.length) || 'text' : rawLanguage;

    segments.push({ type: 'code', language: baseLanguage, content: match[2].trim(), runnable });
    lastIndex = codeBlockRegex.lastIndex;
  }

  const remaining = content.slice(lastIndex);
  if (remaining.trim()) {
    segments.push({ type: 'markdown', content: remaining });
  }

  return segments;
}
