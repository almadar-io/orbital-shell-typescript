'use client';
/**
 * DocumentDetails Molecule
 *
 * The document's settings rail card — the Gutenberg "Document settings"
 * sidebar pattern: a compact bordered panel beside the writing surface
 * holding the record's metadata, so nothing sits between the document's
 * title and its content. Each property edits in place and commits the
 * moment it changes (boolean → switch, options → select, text →
 * click-to-edit input, `readonly` → display only); commits emit
 * `metaCommitEvent` with `{ id, patch }` where patch carries the id plus
 * the one changed field, ready to hand straight to a quiet partial persist.
 *
 * Rows are stacked (muted label over value) — the rail is narrow.
 * Renders nothing when `fields` is empty.
 */
import React, { useState } from 'react';
import type { EntityRow, EventEmit, FieldValue, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { formatValue } from '../../../core';
import { getNestedValue } from '../../../lib/getNestedValue';
import { relationLabel } from '../../../lib/relationLabel';
import { useEventBus } from '../../../core';
import { useTranslate, useFormatContext } from '../../../core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { Card } from '../../../core';
import { Icon } from '../../../core';
import { Input } from '../../../core';
import { Select } from '../../../core';
import { Switch } from '../../../core';
import type { IconInput } from '../../../core';
import { valueLabelFor } from '../../../lib/displayField';

import { domPassthrough } from '../../../core';
export interface DocumentDetailsField {
  /** Entity field name (dot-notation supported for read-only display) */
  name?: string;
  /** Alias for `name` — RecordFieldSpec-style call sites pass `key` */
  key?: string;
  /** Display label (auto-generated from the field name if omitted) */
  label?: string;
  /** RecordFieldSpec-style alias for `label` */
  header?: string;
  /** Lucide icon name or component shown beside the label */
  icon?: IconInput;
  /** How the property edits: text input, boolean switch, select, image
   *  thumbnail, or display-only. Inferred from the value when omitted
   *  (boolean → boolean, array → readonly, image-typed → image, else text). */
  kind?: 'text' | 'boolean' | 'select' | 'readonly' | 'image';
  /** Options for kind: 'select' */
  options?: readonly string[];
  /** Display text per exact value (select options and value chips); unmapped values show as stored */
  labels?: Readonly<Record<string, string>>;
  /** Display format for the read value */
  format?: 'date' | 'currency' | 'number' | 'boolean' | 'percent';
  /** Entity-declared field type, injected by the display fields contract —
   *  drives kind inference (e.g. `image` → thumbnail row). */
  type?: string;
}

/**
 * DocumentDetails — the document's metadata as a compact settings card for
 * the rail beside a DocumentPanel, each property committing in place.
 *
 * @capabilities document settings, page details, post settings sidebar, metadata panel, document properties, publish settings
 * @fieldsContract display
 */
export interface DocumentDetailsProps extends A11yProps {
  /** The loaded record — supplies the id every commit carries and the
   *  values the rows read. */
  entity?: EntityRow;
  /** The properties shown; empty renders nothing. */
  fields?: readonly DocumentDetailsField[];
  /** Emitted when a property commits: { id, patch } — patch carries the id
   *  plus the one changed field, ready for a partial persist update. */
  metaCommitEvent?: EventEmit<{ id: string; patch: Record<string, FieldValue> }>;
  /** Makes relation chips clickable: emitted with { field, id, name } when a
   *  hydrated relation value (or one row of a many-relation) is clicked —
   *  the host routes it to the linked record's own surface. */
  relationEvent?: EventEmit<{ field: string; id: string; name: string }>;
  /** The kernel-injected `{ value, label }` options per relation field; a relation chip reads its label from the
   *  option for its id (labelled by the relation's declared display field), else shows the record id. */
  relationsData?: Readonly<Record<string, ReadonlyArray<{ value: string; label: string }>>>;
  /** Card heading (defaults to the localized "Details") */
  title?: string;
  className?: string;
}

function renderIconInput(icon: IconInput, props: React.ComponentProps<typeof Icon>): React.ReactElement {
  return typeof icon === 'string' ? <Icon name={icon} {...props} /> : <Icon icon={icon} {...props} />;
}

function fieldName(field: DocumentDetailsField): string {
  return field.name ?? field.key ?? '';
}

/** A relation-shaped value's target id, for click-through routing. */
function relationId(value: FieldValue): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const id = value.id;
    if (id !== undefined && id !== null) return String(id);
  }
  return String(value);
}

function fieldKind(field: DocumentDetailsField, value: FieldValue | undefined): NonNullable<DocumentDetailsField['kind']> {
  if (field.kind) return field.kind;
  if (field.type === 'image') return 'image';
  if (field.options && field.options.length > 0) return 'select';
  if (typeof value === 'boolean' || field.format === 'boolean') return 'boolean';
  if (Array.isArray(value) || relationLabel(value ?? null) !== null) return 'readonly';
  return 'text';
}

export function DocumentDetails({
  entity,
  fields,
  metaCommitEvent,
  relationEvent,
  relationsData,
  title,
  className,
  ...rest
}: DocumentDetailsProps): React.ReactElement | null {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const fmt = useFormatContext();
  const [fieldDraft, setFieldDraft] = useState<{ name: string; value: string } | null>(null);

  const recordId = entity?.id !== undefined && entity?.id !== null ? String(entity.id) : '';
  const fieldDefs = (fields ?? []).filter((f) => fieldName(f) !== '');
  if (fieldDefs.length === 0) return null;

  const commitField = (name: string, next: FieldValue, current: FieldValue | undefined) => {
    setFieldDraft(null);
    if (!metaCommitEvent || next === current) return;
    eventBus.emit(`UI:${metaCommitEvent}`, { id: recordId, patch: { id: recordId, [name]: next } });
  };

  // A relation chip: plain when un-routed, a click-through when the host
  // wires `relationEvent` — the "linked entities are navigable" affordance.
  const relationChip = (item: FieldValue, name: string, labels: DocumentDetailsField['labels'], key?: number) => {
    const label = relationLabel(item, relationsData?.[name]) ?? valueLabelFor(String(item), labels);
    if (!relationEvent) {
      return <Badge key={key} variant="default">{label}</Badge>;
    }
    const emitClick = () =>
      eventBus.emit(`UI:${relationEvent}`, { field: name, id: relationId(item), name: label });
    return (
      <Badge
        key={key}
        variant="default"
        role="button"
        tabIndex={0}
        className="cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={emitClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            emitClick();
          }
        }}
        data-testid={`relation-chip-${name}`}
      >
        {label}
      </Badge>
    );
  };

  const renderValue = (field: DocumentDetailsField) => {
    const name = fieldName(field);
    const raw = getNestedValue(entity ?? {}, name);
    const kind = fieldKind(field, raw);
    const label = field.label ?? field.header ?? name;

    if (kind === 'image') {
      const url = typeof raw === 'string' ? raw : '';
      if (!url) return <Typography variant="small" color="secondary">—</Typography>;
      return (
        <img
          src={url}
          alt={label}
          loading="lazy"
          className="max-h-32 w-full rounded-container border border-border object-cover"
          data-testid={`document-property-image-${name}`}
        />
      );
    }

    if (kind === 'boolean') {
      return (
        <Switch
          checked={Boolean(raw)}
          disabled={!metaCommitEvent}
          aria-label={label}
          onChange={(checked) => commitField(name, checked, Boolean(raw))}
        />
      );
    }

    if (kind === 'select') {
      return (
        <Select
          value={raw !== undefined && raw !== null ? String(raw) : ''}
          disabled={!metaCommitEvent}
          aria-label={label}
          className="h-8 w-full"
          options={(field.options ?? []).map((opt) => ({ value: opt, label: valueLabelFor(opt, field.labels) }))}
          onChange={(e) => commitField(name, e.target.value, raw)}
        />
      );
    }

    if (kind === 'readonly' || !metaCommitEvent) {
      if (Array.isArray(raw)) {
        if (raw.length === 0) {
          return <Typography variant="small" color="secondary">—</Typography>;
        }
        return (
          <HStack gap="xs" className="flex-wrap">
            {raw.map((item, i) => relationChip(item, name, field.labels, i))}
          </HStack>
        );
      }
      if (raw !== undefined && raw !== null && raw !== '' && relationLabel(raw) !== null) {
        return relationChip(raw, name, field.labels);
      }
      const shown = raw === undefined || raw === null || raw === ''
        ? '—'
        : formatValue(raw, field.format, fmt);
      return <Typography variant="small" className="break-words">{shown}</Typography>;
    }

    // Editable text property: click-to-edit, commit on blur/Enter, Escape cancels.
    if (fieldDraft?.name === name) {
      return (
        <Input
          value={fieldDraft.value}
          autoFocus
          aria-label={label}
          className="h-8 w-full"
          onChange={(e) => setFieldDraft({ name, value: e.target.value })}
          onBlur={() => commitField(name, fieldDraft.value.trim(), raw)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitField(name, fieldDraft.value.trim(), raw);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setFieldDraft(null);
            }
          }}
          data-testid={`document-property-input-${name}`}
        />
      );
    }
    const shown = raw === undefined || raw === null || raw === ''
      ? '—'
      : relationLabel(raw, relationsData?.[name]) ?? formatValue(raw, field.format, fmt);
    return (
      <Box
        role="button"
        tabIndex={0}
        className={cn(
          'cursor-text rounded-interactive px-1 -mx-1 transition-colors hover:bg-muted/40',
          (raw === undefined || raw === null || raw === '') && 'text-muted-foreground',
        )}
        onClick={() => setFieldDraft({ name, value: raw !== undefined && raw !== null ? String(raw) : '' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setFieldDraft({ name, value: raw !== undefined && raw !== null ? String(raw) : '' });
          }
        }}
        data-testid={`document-property-${name}`}
      >
        <Typography variant="small" className="break-words">{shown}</Typography>
      </Box>
    );
  };

  return (
    <Card {...domPassthrough(rest)} variant="bordered" className={cn('w-full', className)}>
      <VStack gap="sm" className="p-4">
        <Typography variant="caption" color="secondary" weight="medium" className="uppercase tracking-wide">
          {title ?? t('documentDetails.title')}
        </Typography>
        <VStack gap="sm">
          {fieldDefs.map((field) => {
            const name = fieldName(field);
            const label = field.label ?? field.header ?? name;
            return (
              <VStack key={name} gap="xs">
                <HStack gap="xs" className="items-center">
                  {field.icon && renderIconInput(field.icon, { size: 'xs', className: 'text-muted-foreground' })}
                  <Typography variant="caption" color="muted">{label}</Typography>
                </HStack>
                <Box className="min-w-0">{renderValue(field)}</Box>
              </VStack>
            );
          })}
        </VStack>
      </VStack>
    </Card>
  );
}
