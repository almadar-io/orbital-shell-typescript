'use client';

/**
 * AvlExplain — the hover/focus explanation every AVL mark shares: the built-in
 * description in a tooltip, or a popover that stays open while read when the
 * mark carries more: an author note above the built-in description, and/or the
 * mark's code (a guard or an effect) below it, scrollable.
 */

import React from 'react';
import { Tooltip } from '../../core/molecules/Tooltip';
import { Popover } from '../../core/molecules/Popover';
import { Box } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';
import type { AvlNote } from '../../../lib/avl-annotations';

export interface AvlExplainProps {
  /** Built-in lines (name first). */
  lines: readonly string[];
  /** Author note; when present the explanation opens as a popover. */
  note?: AvlNote;
  /** The mark's code (a guard or an effect), shown last in monospace, left to right and scrollable. */
  code?: string;
  children: React.ReactElement;
}

export const AvlExplain: React.FC<AvlExplainProps> = ({ lines, note, code, children }) => {
  if (note !== undefined || code !== undefined) {
    return (
      <Popover
        trigger="hover"
        position="top"
        content={
          <VStack gap="xs" className="max-w-sm">
            {note?.title ? <Typography variant="small" weight="semibold">{note.title}</Typography> : null}
            {note ? <Typography variant="small">{note.body}</Typography> : null}
            <VStack gap="none" className={note ? 'border-t border-border pt-1' : undefined}>
              {lines.map((line, i) => (
                <Typography key={i} variant="caption" color={i === 0 ? 'inherit' : 'muted'} weight={i === 0 ? 'semibold' : 'normal'}>{line}</Typography>
              ))}
            </VStack>
            {code === undefined ? null : (
              <Box
                as="pre"
                dir="ltr"
                data-testid="avl-explain-code"
                className="m-0 max-h-48 overflow-auto rounded-sm bg-muted px-2 py-1 font-mono text-xs whitespace-pre"
              >
                {code}
              </Box>
            )}
          </VStack>
        }
      >
        {children}
      </Popover>
    );
  }
  if (lines.length === 0) return children;
  return (
    <Tooltip
      position="top"
      content={
        <VStack gap="none">
          {lines.map((line, i) => (
            <Box key={i} as="span" className={i === 0 ? 'font-semibold' : 'opacity-80'}>{line}</Box>
          ))}
        </VStack>
      }
    >
      {children}
    </Tooltip>
  );
};

AvlExplain.displayName = 'AvlExplain';
