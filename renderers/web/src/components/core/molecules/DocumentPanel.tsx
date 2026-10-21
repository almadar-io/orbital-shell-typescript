'use client';
/**
 * DocumentPanel Molecule
 *
 * The document writing surface, shaped like the established editors
 * (Notion / Google Docs / Gutenberg's canvas): a big inline-editable title
 * with the content DIRECTLY beneath it — nothing sits between the title and
 * the words. The only chrome is a compact top-right cluster in the header
 * row: while reading it holds a quiet Edit and the "⋯" actions menu; while
 * editing it swaps to the autosave hint + Done. Document metadata lives in
 * a sibling DocumentDetails card (a Gutenberg-style settings rail), never
 * inside this surface.
 *
 * The title commits on blur/Enter (select-on-focus, so typing replaces a
 * placeholder name); the body autosaves through the embedded
 * RichTextEditor's change stream; clicking the read body starts an editing
 * session with the cursor in the text.
 */
import { actionTestId, ACTION_OVERFLOW_TESTID } from '@almadar/core';
import React, { useState } from 'react';
import type { EventKey, EventEmit, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { pressableProps } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Card } from '../../../core';
import { Icon } from '../../../core';
import { Input } from '../../../core';
import type { IconInput } from '../../../core';
import { Menu } from './Menu';
import { RichTextEditor } from './RichTextEditor';

import { domPassthrough } from '../../../core';
export interface DocumentPanelAction {
  label: string;
  event?: EventKey;
  icon?: IconInput;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

/**
 * DocumentPanel — a record rendered as one continuous document: editable
 * title over the rich-text body, editing controls tucked into the header
 * corner.
 *
 * @capabilities document page, note editor, wiki page, article editor, writing surface, rich text document, content editing canvas
 */
export interface DocumentPanelProps extends A11yProps {
  /** The record's id — carried on every commit and action event. */
  id?: string;
  /** Document title (falls back to "Untitled" for a blank draft) */
  title?: string;
  /** Muted byline under the title; hidden when empty */
  subtitle?: string;
  /** Cover/hero image URL painted as a full-bleed banner above the header
   *  row (Notion/article-hero shape); hidden when empty */
  coverImage?: string;
  /** Document icon rendered beside the title (a file glyph, a domain icon);
   *  hidden when empty */
  icon?: IconInput;
  /** The document body as rich-text HTML */
  value?: string;
  /** Header actions (settings, history, …). At most one explicit primary
   *  stays inline; the rest live under a single "⋯" menu — the title owns
   *  its row. */
  actions?: readonly DocumentPanelAction[];
  /** 0 collapses even the primary action into the menu */
  maxInlineActions?: number;
  /** false = read surface with click-to-edit body; true = live editor */
  editing?: boolean;
  /** Emitted when the title commits: { title, id } */
  titleCommitEvent?: EventEmit<{ title: string; id: string }>;
  /** Forwarded to the embedded RichTextEditor's autosave stream: { value } */
  contentChangeEvent?: EventEmit<{ value: string }>;
  /** Emitted by the header Edit affordance and a click on the read body: { id } */
  editEvent?: EventEmit<{ id: string }>;
  /** Emitted by the Done button that ends the editing session: { id } */
  doneEvent?: EventEmit<{ id: string }>;
  editLabel?: string;
  doneLabel?: string;
  /** Muted caption beside Done telling the author work persists on its own */
  autosaveHint?: string;
  /** Placeholder for an empty body */
  placeholder?: string;
  className?: string;
}

function renderIconInput(icon: IconInput, props: React.ComponentProps<typeof Icon>): React.ReactElement {
  return typeof icon === 'string' ? <Icon name={icon} {...props} /> : <Icon icon={icon} {...props} />;
}

export function DocumentPanel({
  id,
  title,
  subtitle,
  coverImage,
  icon,
  value,
  actions,
  maxInlineActions,
  editing = false,
  titleCommitEvent,
  contentChangeEvent,
  editEvent,
  doneEvent,
  editLabel,
  doneLabel,
  autosaveHint,
  placeholder,
  className,
  ...rest
}: DocumentPanelProps): React.ReactElement {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const recordId = id ?? '';
  const actionDefs = actions ?? [];

  // Card rule: the title owns its row — one explicit primary inline at most,
  // everything else under the single "⋯" menu, danger-styled there.
  const inlineCap = Math.min(maxInlineActions ?? 1, 1);
  const inlineActions = actionDefs.filter((a) => a.variant === 'primary').slice(0, inlineCap);
  const menuActions = actionDefs.filter((a) => !inlineActions.includes(a));

  // Actions carry scalars only — consumers needing the full row stash it
  // from the load event (ModalRecordModal's SEED), never from this payload.
  const fireAction = (action: DocumentPanelAction) => {
    if (!action.event) return;
    eventBus.emit(`UI:${action.event}`, { id: recordId, title: title ?? '' });
  };

  // Title commits on blur/Enter; a blank draft or an unchanged one closes the
  // editor without a commit, so a record is never silently renamed to "".
  const commitTitle = () => {
    if (!titleCommitEvent) return;
    const next = (titleDraft ?? '').trim();
    setTitleDraft(null);
    if (!next || next === title) return;
    eventBus.emit(`UI:${titleCommitEvent}`, { title: next, id: recordId });
  };

  const untitled = t('documentPanel.untitled');

  const titleNode =
    titleCommitEvent && titleDraft !== null ? (
      <Input
        value={titleDraft}
        autoFocus
        aria-label={t('common.title')}
        className="h-auto py-1 heading-voice text-3xl"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitTitle();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setTitleDraft(null);
          }
        }}
        data-testid="document-title-input"
      />
    ) : titleCommitEvent ? (
      <Box
        role="button"
        tabIndex={0}
        className="cursor-text rounded-interactive px-1 -mx-1 transition-colors hover:bg-muted/40"
        onClick={() => setTitleDraft(title ?? '')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setTitleDraft(title ?? '');
          }
        }}
        data-testid="document-title-editable"
      >
        <Typography variant="h2" className={cn(!title && 'text-muted-foreground')}>
          {title || untitled}
        </Typography>
      </Box>
    ) : (
      <Typography variant="h2">
        {title || untitled}
      </Typography>
    );

  const emitWithId = (event: EventKey | undefined) => () => {
    if (event) eventBus.emit(`UI:${event}`, { id: recordId });
  };

  return (
    <Card {...domPassthrough(rest)} variant="elevated" className={cn('w-full overflow-hidden', className)}>
      {/* Cover banner: full-bleed above the header row, never between the
          title and the words. Object-cover so any aspect ratio reads as a
          deliberate hero, not a stretched thumbnail. */}
      {coverImage ? (
        <Box className="h-44 w-full sm:h-52" data-testid="document-cover">
          <img
            src={coverImage}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        </Box>
      ) : null}
      <VStack gap="sm" className="p-6 sm:p-8">
        {/* Header: identity left, the ONLY chrome right — Edit + ⋯ while
            reading, autosave hint + Done while editing. Nothing else sits
            between the title and the words. */}
        <HStack gap="sm" className="justify-between items-start">
          <VStack gap="xs" className="flex-1 min-w-0">
            {icon ? (
              <Box className="text-muted-foreground" data-testid="document-icon">
                {renderIconInput(icon, { size: 'lg' })}
              </Box>
            ) : null}
            {titleNode}
            {subtitle ? (
              <Typography variant="small" color="secondary">{subtitle}</Typography>
            ) : null}
          </VStack>
          <HStack gap="xs" className="flex-shrink-0 pt-1 items-center">
            {editing ? (
              <>
                <Typography variant="caption" color="muted" className="hidden sm:block">
                  {autosaveHint ?? t('documentPanel.autosaveHint')}
                </Typography>
                <Button variant="primary" size="sm" onClick={emitWithId(doneEvent)} data-testid="document-done">
                  {doneLabel ?? t('documentPanel.done')}
                </Button>
              </>
            ) : (
              <>
                {editEvent && (
                  <Button variant="ghost" size="sm" onClick={emitWithId(editEvent)} data-testid="document-edit">
                    <Icon name="edit" size="xs" className="mr-1" />
                    {editLabel ?? t('documentPanel.edit')}
                  </Button>
                )}
                {inlineActions.map((action, idx) => (
                  <Button
                    key={idx}
                    variant="primary"
                    size="sm"
                    onClick={() => fireAction(action)}
                    data-testid={action.event ? actionTestId(action.event) : undefined}
                  >
                    {action.icon && renderIconInput(action.icon, { size: 'xs', className: 'mr-1' })}
                    {action.label}
                  </Button>
                ))}
                {menuActions.length > 0 && (
                  <Menu
                    position="bottom-end"
                    trigger={
                      <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid={ACTION_OVERFLOW_TESTID}>
                        <Icon name="more-horizontal" size="xs" />
                      </Button>
                    }
                    items={menuActions.map((action) => ({
                      label: action.label,
                      icon: action.icon,
                      variant: action.variant === 'danger' ? ('danger' as const) : ('default' as const),
                      onClick: () => fireAction(action),
                    }))}
                  />
                )}
              </>
            )}
          </HStack>
        </HStack>

        {/* The document itself, front and center. */}
        {editing ? (
          <RichTextEditor value={value} changeEvent={contentChangeEvent} placeholder={placeholder} />
        ) : (
          <Box
            {...pressableProps(editEvent ? emitWithId(editEvent) : undefined)}
            aria-label={editEvent ? (editLabel ?? t('documentPanel.edit')) : undefined}
            className={cn(
              'rounded-interactive px-1 -mx-1 min-h-[16rem]',
              editEvent && 'cursor-text transition-colors hover:bg-muted/30',
            )}
            data-testid="document-body"
          >
            {value && value !== '' ? (
              <RichTextEditor value={value} readOnly />
            ) : (
              <Typography variant="body" color="muted">
                {placeholder ?? t('documentPanel.placeholder')}
              </Typography>
            )}
          </Box>
        )}
      </VStack>
    </Card>
  );
}
