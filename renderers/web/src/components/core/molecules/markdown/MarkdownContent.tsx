/**
 * MarkdownContent Molecule Component
 *
 * Renders markdown content with support for GFM (GitHub Flavored Markdown)
 * and math equations (KaTeX). Handles inline code only — fenced code blocks
 * should be parsed out and rendered with CodeBlock component.
 *
 * Event Contract:
 * - No events emitted (display-only component)
 * - entityAware: false
 *
 * NOTE: react-markdown's `components` override API requires native HTML
 * elements — this is the same library-boundary exception as `<iframe>` in
 * DocumentViewer and `<svg>` in JazariStateMachine/StateMachineView.
 */

import type { A11yProps, EventEmit } from '@almadar/core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Box } from '../../../../core';
import { CodeBlock, toCodeLanguage } from './CodeBlock';
import { TextHighlight } from '../../../../core';
import { SelectionAnnotator } from './SelectionAnnotator';
import { rehypeAnnotate, type ContentAnnotation } from '../../../../lib/content-annotations';
import { MermaidDiagram } from './MermaidDiagram';
import { useTranslate } from '../../../../core';
import { cn } from '../../../../core';

import { domPassthrough } from '../../../../core';
function samePassthrough(a: MarkdownContentProps, b: MarkdownContentProps): boolean {
  const pa = domPassthrough(a);
  const pb = domPassthrough(b);
  const keys = Object.keys(pa);
  return keys.length === Object.keys(pb).length && keys.every((k) => pa[k] === pb[k]);
}

// A behavior can carry its own figures, so an image src may be a `data:image/` URL;
// every other URL keeps react-markdown's safe-protocol filter.
const urlTransform: UrlTransform = (url, key, node) =>
  key === 'src' && node.tagName === 'img' && /^data:image\//i.test(url) ? url : defaultUrlTransform(url);

type MdNode = { type: string; children?: MdNode[] };
type RehypeKatexPlugin = typeof import('./katexPlugin').rehypeKatex;

let loadedKatex: RehypeKatexPlugin | undefined;

function loadKatex(): Promise<RehypeKatexPlugin> {
  if (loadedKatex !== undefined) return Promise.resolve(loadedKatex);
  return import('./katexPlugin').then((m) => {
    loadedKatex = m.rehypeKatex;
    return m.rehypeKatex;
  });
}

function containsMath(node: MdNode): boolean {
  if (node.type === 'math' || node.type === 'inlineMath') return true;
  return node.children?.some(containsMath) ?? false;
}

export interface MarkdownContentProps extends A11yProps {
  /** The markdown content to render */
  content: string;
  /** Text direction (defaults to ltr; `ltr` is first so the generated config seeds it) */
  direction?: 'ltr' | 'rtl';
  /** Event emitted when the reader picks Ask on selected text (as `UI:<askEvent>`) */
  askEvent?: EventEmit<{ selectedText: string }>;
  /** Event emitted when the reader picks Note on selected text (as `UI:<noteEvent>`) */
  noteEvent?: EventEmit<{ selectedText: string }>;
  /** Ask action label (default: translated) */
  askLabel?: string;
  /** Note action label (default: translated) */
  noteLabel?: string;
  /**
   * Passages to highlight. Each `text` is matched exactly, first occurrence in
   * document order inside a single rendered text node (outside code); a passage
   * that spans formatting boundaries is not highlighted.
   */
  annotations?: ContentAnnotation[];
  /** Event emitted when a highlighted passage is clicked (as `UI:<annotationEvent>`) */
  annotationEvent?: EventEmit<{ annotationId?: string }>;
  /** Additional CSS classes */
  className?: string;
}

export const MarkdownContent = React.memo<MarkdownContentProps>(
  ({ content, direction = 'ltr', askEvent, noteEvent, askLabel, noteLabel, annotations, annotationEvent, className, ...rest }) => {
    const { t: _t } = useTranslate();
    const safeContent = typeof content === 'string' ? content : String(content ?? '');
    const sawMath = useRef(false);
    const [katex, setKatex] = useState<RehypeKatexPlugin | undefined>(() => loadedKatex);
    const detectMath = useMemo(
      () => () => (tree: MdNode) => {
        sawMath.current = containsMath(tree);
      },
      [],
    );
    useEffect(() => {
      if (!sawMath.current || katex !== undefined) return undefined;
      let live = true;
      void loadKatex().then((plugin) => {
        if (live) setKatex(() => plugin);
      });
      return () => {
        live = false;
      };
    }, [safeContent, katex]);
    const body = (
      <Box
        {...domPassthrough(rest)}
        className={cn('prose max-w-none', className)}
        style={{
          color: 'var(--color-foreground)',
          '--tw-prose-body': 'var(--color-foreground)',
          '--tw-prose-headings': 'var(--color-foreground)',
          '--tw-prose-lead': 'var(--color-muted-foreground)',
          '--tw-prose-links': 'var(--color-primary)',
          '--tw-prose-bold': 'var(--color-foreground)',
          '--tw-prose-counters': 'var(--color-muted-foreground)',
          '--tw-prose-bullets': 'var(--color-muted-foreground)',
          '--tw-prose-hr': 'var(--color-border)',
          '--tw-prose-quotes': 'var(--color-foreground)',
          '--tw-prose-quote-borders': 'var(--color-primary)',
          '--tw-prose-captions': 'var(--color-muted-foreground)',
          '--tw-prose-code': 'var(--color-foreground)',
          '--tw-prose-pre-code': 'var(--color-foreground)',
          '--tw-prose-pre-bg': 'var(--color-muted)',
          '--tw-prose-th-borders': 'var(--color-border)',
          '--tw-prose-td-borders': 'var(--color-border)',
          direction,
        } as React.CSSProperties}
      >
        <ReactMarkdown
          urlTransform={urlTransform}
          remarkPlugins={[remarkMath, remarkGfm, detectMath]}
          rehypePlugins={[
            ...(annotations && annotations.length > 0 ? [rehypeAnnotate(annotations)] : []),
            ...(katex !== undefined ? [[katex, { strict: false, throwOnError: false }] as [RehypeKatexPlugin, { strict: boolean; throwOnError: boolean }]] : []),
          ]}
          components={{
            code({
              className: codeClassName,
              children,
              inline,
              ...props
            }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean }) {
              if (!inline) {
                const match = /language-(\w+)/.exec(codeClassName ?? '');
                const code = String(children).replace(/\n$/, '');
                // Fenced ```mermaid block — render as a diagram
                if (match?.[1] === 'mermaid') {
                  return <MermaidDiagram code={code} />;
                }
                // Fenced block with a language — render with CodeBlock for syntax highlighting
                if (match) {
                  return (
                    <CodeBlock
                      code={code}
                      language={toCodeLanguage(match[1])}
                      maxHeight="60vh"
                    />
                  );
                }
                // Indented block without language — styled like inline code, flows inline
                return (
                  <code
                    {...props}
                    className={codeClassName}
                    style={{
                      backgroundColor: 'var(--color-muted)',
                      color: 'var(--color-foreground)',
                      border: '1px solid var(--color-border)',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '0.25rem',
                      fontSize: '0.875em',
                      fontFamily: 'ui-monospace, monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {children}
                  </code>
                );
              }
              // Inline code
              return (
                <code
                  {...props}
                  className={codeClassName}
                  style={{
                    backgroundColor: 'var(--color-muted)',
                    color: 'var(--color-foreground)',
                    border: '1px solid var(--color-border)',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.875em',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  {children}
                </code>
              );
            },
            mark({ node }) {
              const id = node?.properties?.dataAnnotationId;
              const kind = node?.properties?.dataAnnotationKind;
              return (
                <TextHighlight
                  highlightType={kind === 'question' ? 'question' : 'note'}
                  annotationId={typeof id === 'string' ? id : undefined}
                  action={annotationEvent}
                >
                  {node?.children.map((c) => (c.type === 'text' ? c.value : ''))}
                </TextHighlight>
              );
            },
            // Style links
            a({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) {
              return (
                <a
                  href={href}
                  {...props}
                  className="text-[var(--color-primary)] hover:underline"
                  target={href?.startsWith('http') ? '_blank' : undefined}
                  rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  {children}
                </a>
              );
            },
            // Style tables
            table({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) {
              return (
                <div className="overflow-x-auto my-4">
                  <table
                    {...props}
                    className="min-w-full border-collapse border border-[var(--color-border)]"
                  >
                    {children}
                  </table>
                </div>
              );
            },
            th({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) {
              return (
                <th
                  {...props}
                  className="border border-[var(--color-border)] bg-[var(--color-muted)] px-4 py-2 text-left font-semibold"
                >
                  {children}
                </th>
              );
            },
            td({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) {
              return (
                <td
                  {...props}
                  className="border border-[var(--color-border)] px-4 py-2"
                >
                  {children}
                </td>
              );
            },
            // Strip <pre> wrapper so block code renders inline when needed
            pre({ children }: React.ComponentPropsWithoutRef<'pre'>) {
              return <>{children}</>;
            },
            // Style blockquotes
            blockquote({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) {
              return (
                <blockquote
                  {...props}
                  className="border-l-heavy border-[var(--color-primary)] pl-4 italic text-[var(--color-foreground)] my-4"
                >
                  {children}
                </blockquote>
              );
            },
          }}
        >
          {safeContent}
        </ReactMarkdown>
      </Box>
    );
    if (!askEvent && !noteEvent) return body;
    return (
      <SelectionAnnotator askEvent={askEvent} noteEvent={noteEvent} askLabel={askLabel} noteLabel={noteLabel}>
        {body}
      </SelectionAnnotator>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.className === next.className &&
    prev.direction === next.direction &&
    prev.askEvent === next.askEvent &&
    prev.noteEvent === next.noteEvent &&
    prev.askLabel === next.askLabel &&
    prev.noteLabel === next.noteLabel &&
    prev.annotations === next.annotations &&
    prev.annotationEvent === next.annotationEvent &&
    samePassthrough(prev, next),
);

MarkdownContent.displayName = 'MarkdownContent';
