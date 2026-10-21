'use client';
/**
 * CodeRunnerPanel Organism Component
 *
 * Editable code block with Run/Reset buttons and a terminal output pane.
 * Running is the program's job: Run emits the declared `runEvent` request and the
 * program binds the result back through `output` / `running` / `error`.
 *
 * Event Contract:
 * - Emits: UI:<runEvent> { code, language, runId? } on Run
 * - Emits: UI:<resetEvent> { runId? } on Reset (when declared)
 * - Emits: UI:COPY_CODE { language, success } on Copy
 * - entityAware: false
 */

import React, { useState, useCallback } from 'react';
import { Play, RotateCcw, Terminal, CheckCircle, XCircle, Copy, Check } from 'lucide-react';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Badge } from '../../../core';
import { Typography } from '../../../core';
import { VStack, HStack } from '../../../core';
import { CodeBlock } from '../molecules/markdown/CodeBlock';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';
import type { A11yProps, EventEmit } from '@almadar/core';
import { domPassthrough } from '../../../core';

export interface CodeSimulationOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  testResults: Array<{
    input: string;
    expectedOutput: string;
    actualOutput: string;
    passed: boolean;
  }>;
}

export interface CodeRunnerPanelProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Initial code content */
  code: string;
  /** Programming language for syntax highlighting */
  language: string;
  /** Whether the panel is editable and runnable (default false = read-only code block) */
  runnable?: boolean;
  /** Event emitted on Run as `UI:<runEvent>` with `{ code, language, runId }`. Defaults to 'RUN_CODE'. */
  runEvent?: EventEmit<{ code: string; language: string; runId: string }>;
  /** Event emitted on Reset as `UI:<resetEvent>` with `{ runId }`; Reset only restores the code when absent. */
  resetEvent?: EventEmit<{ runId: string }>;
  /** Identifies this panel in its run/reset payloads (e.g. a lesson segment); empty when one panel stands alone. */
  runId?: string;
  /** The program's result for the last run, bound back into the panel. */
  output?: CodeSimulationOutput | null;
  /** True while the program is running the code. */
  running?: boolean;
  /** A run failure message from the program; replaces the output body. */
  error?: string | null;
  /** Additional CSS classes */
  className?: string;
}

export const CodeRunnerPanel: React.FC<CodeRunnerPanelProps> = ({
  code: initialCode,
  language,
  runnable = false,
  runEvent = 'RUN_CODE',
  resetEvent,
  runId = '',
  output = null,
  running = false,
  error = null,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const [code, setCode] = useState(initialCode);
  const [copied, setCopied] = useState(false);
  const isRunning = running;

  const handleRun = useCallback(() => {
    eventBus.emit(`UI:${runEvent}`, { code, language, runId });
  }, [code, language, runEvent, runId, eventBus]);

  const handleReset = useCallback(() => {
    setCode(initialCode);
    if (resetEvent) eventBus.emit(`UI:${resetEvent}`, { runId });
  }, [initialCode, resetEvent, runId, eventBus]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      eventBus.emit('UI:COPY_CODE', { language, success: true });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      eventBus.emit('UI:COPY_CODE', { language, success: false });
    }
  }, [code, language, eventBus]);

  if (!runnable) {
    return (
      <Box {...domPassthrough(rest)} className={className}>
        <CodeBlock language={language as Parameters<typeof CodeBlock>[0]['language']} code={code} />
      </Box>
    );
  }

  const hasOutput = output !== null || error !== null;

  return (
    <Box {...domPassthrough(rest)} className={cn('space-y-3', className)}>
      {/* editable CodeBlock sizes via height:100% + flex:1; needs a concrete parent height */}
      <Box className="group relative" style={{ height: 360 }}>
        <CodeBlock
          language={language as Parameters<typeof CodeBlock>[0]['language']}
          code={code}
          editable
          onChange={setCode}
          showLanguageBadge
          showCopyButton={false}
          maxHeight="100%"
        />

        {/* Hover toolbar: Copy / Reset / Run. Revealed on hover or keyboard
            focus-within so the lesson body isn't polluted with per-block
            button rows. */}
        <HStack
          gap="xs"
          align="center"
          className="absolute top-2 right-2 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity bg-[var(--color-card)]/90 backdrop-blur-sm rounded-container p-1 shadow-elevation-popover border border-border"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            icon={copied ? Check : Copy}
            aria-label={t('common.copy')}
            className={copied ? 'text-success' : ''}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isRunning}
            icon={RotateCcw}
            aria-label={t('common.reset')}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleRun}
            isLoading={isRunning}
            icon={isRunning ? RotateCcw : Play}
            className={isRunning ? '[&_svg]:animate-spin' : ''}
          >
            {isRunning ? t('common.loading') : t('codeRunner.run')}
          </Button>
        </HStack>
      </Box>

      {hasOutput && (
        <Box className="rounded-container border border-border bg-foreground overflow-hidden">
          <HStack
            gap="sm"
            align="center"
            className="px-3 py-2 bg-card border-b border-border"
          >
            <Terminal size={16} className="text-muted-foreground" />
            <Typography variant="small" className="text-foreground font-medium">
              {t('codeRunner.output')}
            </Typography>
            {output && (
              <Badge
                variant={output.exitCode === 0 ? 'success' : 'danger'}
                size="sm"
              >
                {t('codeRunner.exit', { code: output.exitCode })}
              </Badge>
            )}
          </HStack>

          <VStack gap="none" className="p-3 font-mono text-sm">
            {error ? (
              <Typography variant="small" className="text-error whitespace-pre-wrap">
                {error}
              </Typography>
            ) : (
              <>
                {output?.stdout ? (
                  <Typography variant="small" className="text-background whitespace-pre-wrap">
                    {output.stdout}
                  </Typography>
                ) : null}
                {output?.stderr ? (
                  <Typography variant="small" className="text-error whitespace-pre-wrap">
                    {output.stderr}
                  </Typography>
                ) : null}
                {!output?.stdout && !output?.stderr ? (
                  <Typography variant="small" className="text-background italic">
                    {t('codeRunner.noOutput')}
                  </Typography>
                ) : null}

                {output && output.testResults.length > 0 && (
                  <Box className="mt-3 pt-3 border-t border-border space-y-2">
                    {output.testResults.map((test, index) => (
                      <HStack key={index} gap="sm" align="start" className="text-xs">
                        {test.passed ? (
                          <CheckCircle size={14} className="text-success mt-0.5" />
                        ) : (
                          <XCircle size={14} className="text-error mt-0.5" />
                        )}
                        <VStack gap="xs" className="flex-1">
                          <Typography
                            variant="small"
                            className={test.passed ? 'text-success' : 'text-error'}
                          >
                            {test.passed ? t('codeRunner.testPassed', { number: index + 1 }) : t('codeRunner.testFailed', { number: index + 1 })}
                          </Typography>
                          <Typography variant="small" className="text-background">
                            {t('codeRunner.input', { value: test.input })}
                          </Typography>
                          <Typography variant="small" className="text-background">
                            {t('codeRunner.expected', { value: test.expectedOutput })}
                          </Typography>
                          <Typography variant="small" className="text-background">
                            {t('codeRunner.actual', { value: test.actualOutput })}
                          </Typography>
                        </VStack>
                      </HStack>
                    ))}
                  </Box>
                )}
              </>
            )}
          </VStack>
        </Box>
      )}
    </Box>
  );
};

CodeRunnerPanel.displayName = 'CodeRunnerPanel';
