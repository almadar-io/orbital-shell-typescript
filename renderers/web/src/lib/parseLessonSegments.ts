/**
 * parseLessonSegments — parses lesson markdown with embedded learning-science
 * XML-style tags into a typed Segment array.
 *
 * Supported tags: <activate>, <connect>, <reflect>, <bloom level="...">,
 * <question>/<answer>, <visualize type="..." description="..." />.
 *
 * Tags may be open (unclosed) — the parser falls back to consuming content
 * until the next recognised tag, a section heading (`\n\n#`), or end-of-input.
 */

import type { InteractiveOrbitalType, LessonSegment } from '../components/core/organisms/SegmentRenderer';
import type { BloomLevel } from '../components/core/molecules/BloomQuizBlock';
import { parseMarkdownWithCodeBlocks } from './lessonSegmentUtils';

// ── Segment types ─────────────────────────────────────────────────────────────

// The segment types are declared in `SegmentRenderer.tsx` (their consumer): the
// pattern-sync scanner only indexes types under `components/**`, so a union
// living in `lib/` collapses to its one inline arm in the generated knob.
export type { InteractiveOrbitalType, LessonSegment };

// `LessonUserProgress` is declared in `SegmentRenderer.tsx` (its one consumer)
// instead of here: the pattern-sync scanner that builds `.lolo` factory knobs
// only indexes types declared under `components/**`, so a prop-shape type
// living in `lib/` is invisible to it and degrades to an unshaped `json`
// knob even though the interface itself is fully concrete.

// ── Internal helpers ──────────────────────────────────────────────────────────

function extractTagContent(
  content: string,
  tagName: string,
): { content: string; fullMatch: string } | null {
  const closedTagRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const closedMatch = content.match(closedTagRegex);
  if (closedMatch) {
    return { content: closedMatch[1].trim(), fullMatch: closedMatch[0] };
  }

  const unclosedTagRegex = new RegExp(
    `<${tagName}>([\\s\\S]*?)(?=<(?:activate|connect|reflect|bloom|prq|question|answer|visualize)|\\n\\n#|$)`,
    'i',
  );
  const unclosedMatch = content.match(unclosedTagRegex);
  if (unclosedMatch) {
    return { content: unclosedMatch[1].trim(), fullMatch: unclosedMatch[0] };
  }

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse a lesson string into typed segments. Returns `[]` when input is empty. */
export function parseLessonSegments(lesson: string | undefined): LessonSegment[] {
  if (!lesson) return [];

  let content = lesson.replace(/<prq>[\s\S]*?<\/prq>/gi, '').trim();
  const segments: LessonSegment[] = [];

  const activateResult = extractTagContent(content, 'activate');
  if (activateResult) {
    segments.push({ type: 'activate', question: activateResult.content });
    content = content.replace(activateResult.fullMatch, '').trim();
  }

  const connectResult = extractTagContent(content, 'connect');
  if (connectResult) {
    segments.push({ type: 'connect', content: connectResult.content });
    content = content.replace(connectResult.fullMatch, '').trim();
  }

  const tagRegex = new RegExp(
    '(?<reflect><reflect>(?<reflectClosed>[\\s\\S]*?)<\\/reflect>)|' +
      '(?<reflectUnclosed><reflect>(?<reflectOpen>[\\s\\S]*?)(?=<(?:activate|connect|reflect|bloom|prq|question|answer|visualize)|\\n\\n#|$))|' +
      '(?<bloom><bloom\\s+level="(?<bloomLevel>remember|understand|apply|analyze|evaluate|create)">(?<bloomClosed>[\\s\\S]*?)<\\/bloom>)|' +
      '(?<bloomUnclosed><bloom\\s+level="(?<bloomLevelUn>remember|understand|apply|analyze|evaluate|create)">(?<bloomOpen>[\\s\\S]*?)(?=<(?:activate|connect|reflect|bloom|prq|question|answer|visualize)|\\n\\n#|$))|' +
      '(?<quiz><question>(?<quizQuestion>[\\s\\S]*?)<\\/question>\\s*<answer>(?<quizAnswer>[\\s\\S]*?)<\\/answer>)|' +
      '(?<visualize><visualize\\s+type="(?<vizType>algorithms|math|physics|biology|chemistry|probability)"\\s+description="(?<vizDesc>[^"]*?)"\\s*\\/?>)',
    'gi',
  );

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push(...parseMarkdownWithCodeBlocks(before));
    }

    const g = match.groups ?? {};

    if (g.reflect || g.reflectUnclosed) {
      const prompt = (g.reflectClosed ?? g.reflectOpen ?? '').trim();
      if (prompt) segments.push({ type: 'reflect', prompt });
    } else if (g.bloom || g.bloomUnclosed) {
      const level = (g.bloomLevel ?? g.bloomLevelUn) as BloomLevel;
      const bloomContent = g.bloomClosed ?? g.bloomOpen ?? '';

      if (level && bloomContent) {
        const qMatch = bloomContent.match(/<question>([\s\S]*?)<\/question>/i);
        const aMatch = bloomContent.match(/<answer>([\s\S]*?)<\/answer>/i);

        if (qMatch && aMatch) {
          segments.push({ type: 'bloom', level, question: qMatch[1].trim(), answer: aMatch[1].trim() });
        } else if (qMatch) {
          segments.push({ type: 'bloom', level, question: qMatch[1].trim(), answer: '(Answer not provided)' });
        } else {
          const clean = bloomContent
            .replace(/^\*\*Question\s*\d*:?\*\*\s*/i, '')
            .replace(/^\*\*Q\d*:?\*\*\s*/i, '')
            .trim();
          if (clean) segments.push({ type: 'bloom', level, question: clean, answer: '(See answers section below)' });
        }
      }
    } else if (g.quiz) {
      segments.push({ type: 'quiz', question: g.quizQuestion.trim(), answer: g.quizAnswer.trim() });
    } else if (g.visualize) {
      segments.push({
        type: 'visualization',
        visualizationType: g.vizType as InteractiveOrbitalType,
        description: g.vizDesc ?? '',
      });
    }

    lastIndex = tagRegex.lastIndex;
  }

  const remaining = content.slice(lastIndex);
  if (remaining.trim()) segments.push(...parseMarkdownWithCodeBlocks(remaining));

  return segments;
}
