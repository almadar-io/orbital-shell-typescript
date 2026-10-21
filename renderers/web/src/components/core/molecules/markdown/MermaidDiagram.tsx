/**
 * MermaidDiagram Molecule Component
 *
 * Renders a mermaid diagram from the body of a ```mermaid fenced block.
 * The mermaid library is loaded lazily on first use (a literal dynamic
 * import the consumer's bundler code-splits), so apps that never show a
 * diagram never pay for it.
 *
 * Diagram source is frequently LLM-authored (kflow lessons), so a source that
 * fails to parse is retried through `mermaidRepairCandidates` — mermaid's own
 * parser accepts or rejects each candidate, so a repaired diagram is one the
 * parser vouched for, never a guess. Source that parses is never rewritten.
 * When nothing parses the reader gets the diagram source, not the parser's
 * token dump; the raw message goes to the log for whoever is debugging.
 *
 * Event Contract:
 * - No events emitted (display-only component)
 * - entityAware: false
 *
 * NOTE: mermaid's render API returns an SVG string, so the container is
 * filled via innerHTML — the same library-boundary exception as `<iframe>`
 * in DocumentViewer and react-markdown's native-element overrides in
 * MarkdownContent. securityLevel 'strict' keeps the output sanitized.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { createLogger } from '@almadar/logger';
import { Box } from '../../../../core';
import { Typography } from '../../../../core';
import { CodeBlock } from './CodeBlock';
import { mermaidRepairCandidates } from './mermaidSource';
import { useScopedMode } from '../../../../core';
import { useCanvasTheme } from '../../../../hooks/useCanvasTheme';
import { mermaidThemeVariables } from '../../../../lib/mermaidTheme';
import { useTranslate } from '../../../../core';
import { cn } from '../../../../core';

const log = createLogger('almadar:ui:mermaid-diagram');

export interface MermaidDiagramProps {
  /** Mermaid diagram source (the fenced ```mermaid block body) */
  code: string;
  /** Additional CSS classes */
  className?: string;
}

type MermaidApi = typeof import('mermaid').default;

let mermaidModule: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  mermaidModule ??= import('mermaid').then((m) => m.default);
  return mermaidModule;
}

export const MermaidDiagram = React.memo<MermaidDiagramProps>(
  ({ code, className }) => {
    const resolvedMode = useScopedMode();
    const { t } = useTranslate();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [unrenderable, setUnrenderable] = useState(false);
    const reactId = useId();
    const { theme: canvasTheme, version: themeVersion } = useCanvasTheme(containerRef);

    useEffect(() => {
      if (canvasTheme === null) return;
      let active = true;
      void (async () => {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: mermaidThemeVariables(canvasTheme, resolvedMode),
          // Mermaid's default is to append its "Syntax error in text" bomb
          // graphic to <body> on a failed parse, outside any error boundary —
          // the catch below owns failure presentation (source + log), so the
          // library must not paint its own.
          suppressErrorRendering: true,
        });
        // render() requires a document-unique element id; useId emits `:`
        // which is invalid inside the CSS selectors mermaid builds from it.
        const domId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;

        let firstError: Error | null = null;
        for (const [index, source] of [code, ...mermaidRepairCandidates(code)].entries()) {
          try {
            const { svg } = await mermaid.render(domId, source);
            if (!active) return;
            const container = containerRef.current;
            if (container === null) return;
            container.innerHTML = svg;
            container.dataset.mermaidRepaired = String(index > 0);
            setUnrenderable(false);
            if (index > 0) log.debug('mermaid:repaired', { candidate: index });
            return;
          } catch (err: unknown) {
            firstError ??= err instanceof Error ? err : new Error(String(err));
          }
        }
        if (!active) return;
        log.warn('mermaid:unrenderable', { error: firstError?.message ?? '', code });
        setUnrenderable(true);
      })();
      return () => {
        active = false;
      };
    }, [code, resolvedMode, reactId, canvasTheme, themeVersion]);

    // The container stays mounted through the failure state so a corrected
    // `code` prop can re-render into it (the effect writes via its ref).
    return (
      <Box className={cn('not-prose my-4', className)}>
        {unrenderable && (
          <Box className="space-y-2 mb-2" data-testid="mermaid-unrenderable">
            <Typography variant="caption" className="text-muted-foreground">
              {t('mermaid.unrenderable')}
            </Typography>
            <CodeBlock code={code} language="mermaid" />
          </Box>
        )}
        <Box
          ref={containerRef}
          data-testid="mermaid-diagram"
          className="overflow-x-auto"
          style={unrenderable ? { display: 'none' } : undefined}
        />
      </Box>
    );
  },
  (prev, next) => prev.code === next.code && prev.className === next.className,
);

MermaidDiagram.displayName = 'MermaidDiagram';
