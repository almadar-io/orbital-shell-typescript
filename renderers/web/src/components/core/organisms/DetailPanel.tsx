'use client';
/**
 * DetailPanel Organism Component
 *
 * Composes atoms and molecules to create a professional detail view.
 *
 * Data is provided by the runtime via the `entity` prop.
 * Extends DisplayStateProps (see ./types.ts) and declares `entity?: EntityRow`.
 */

import { actionTestId, ACTION_OVERFLOW_TESTID } from '@almadar/core';
import React, { useCallback, useContext, useEffect, Suspense, lazy } from "react";
import type { A11yProps, SkeletonSpec, EventPayload, EntityRow, EntityWith, FieldValue, EventKey } from "@almadar/core";
import { Skeleton } from "../molecules/Skeleton";
import type { RelationFieldCardinality } from "../molecules/RelationSelect";
import type { ItemActionPayload } from "@almadar/core/patterns";
import { ArrowLeft, FileText, X } from "lucide-react";
import type { IconInput } from '../../../core';
import { Badge, Typography, Icon, Avatar, Button, Divider, ProgressBar } from '../../../core';
import { Box } from '../../../core';
import { Image } from '../../../core';
import { DetailLookLayout, type DetailLook, type DetailStage, type DetailTab } from "./detail-looks/DetailLookLayout";
import type { TimelineItem } from "./Timeline";
import type { TableViewColumn } from "../molecules/TableView";
import type { ReplyNodeRow } from "../molecules/ReplyTree";
import { Input } from '../../../core';
import { VStack, HStack } from '../../../core';
import { SimpleGrid } from "../molecules/SimpleGrid";
import { Menu } from "../molecules/Menu";
import { LoadingState } from "../molecules/LoadingState";
import { ErrorState } from "../molecules/ErrorState";
import { EmptyState } from "../molecules/EmptyState";
import { cn } from '../../../core';
import { SlotContainedContext } from "../../../lib/slotContained";
import { formatValue, type FormatContext } from '../../../core';
import { normalizeDisplayField, badgeVariantFor, titleFieldOf, valueLabelFor } from "../../../lib/displayField";
import type { DisplayField, DisplayFieldFormat } from '../../../core';
import type { TranslateFunction } from '../../../core';
import { getNestedValue } from "../../../lib/getNestedValue";
import { relationDisplayLabels } from "../../../lib/relationLabel";
import { useEventBus } from '../../../core';
import { useRowActions, useRowActionPayload } from "../../../hooks/useRowActions";
import type { RowActionCondition, RowActionPayload } from "../../../lib/row-action-when";
import { useTranslate, useFormatContext } from '../../../core';
import { usePendingAction } from '../../../core';
import { useContentSurface, SurfaceBoundary } from '../../../core';
import type { SurfaceMode } from "@almadar/core";
import { useNavStack } from '../../../core';
import { useRenderSlot } from "../../../providers/RenderSlotContext";
import type { DisplayStateProps } from "./types";
import type { RelationOption } from "../molecules/RelationSelect";
import { formatFileSize } from "../molecules/UploadDropZone";
import { ThemedPortal } from "../../../lib/ThemedPortal";
import { domPassthrough } from '../../../core';

const formatFieldLabel = (name: string): string => name;

function formatPlain(value: FieldValue | undefined, format: DisplayFieldFormat | undefined, fmt: FormatContext): string {
  if (value instanceof Date && format === undefined) return formatValue(value, "date", fmt);
  return formatValue(value, format, fmt);
}

// Lazy-load react-markdown only when needed
const ReactMarkdown = lazy(() => import("react-markdown"));

/** Typed field definition from entity schema (name + type). */
interface TypedFieldDef {
  name: string;
  type: string;
}

/** Relation descriptor injected onto a display field — target entity +
 *  cardinality, mirroring the `.lolo` `{type:"relation", relation:{...}}`
 *  descriptor. */
export interface DetailRelationMeta {
  entity: string;
  cardinality?: RelationFieldCardinality;
}

/** Schema metadata for one display field, injected by the runtime's
 *  detail enrichment (UISlotRenderer) or the compiled path's codegen. */
export interface FieldMeta {
  type?: string;
  /** Closed vocabulary — a `.lolo` string union's `values` sidecar. */
  values?: readonly string[];
  /** Relation target + cardinality, when the field is relation-typed. */
  relation?: DetailRelationMeta;
  /** Relation options for display-name resolution (from `relationsData`,
   *  injected server-side by the runtime / bound by compiled codegen). */
  options?: readonly RelationOption[];
}

/**
 * Render a field value with rich content support based on entity field type.
 * Uses the schema-declared type (not regex heuristics) to decide rendering.
 */
function renderRichFieldValue(
  value: FieldValue | undefined,
  field: ResolvedField,
  ctx: RenderContext,
  meta?: FieldMeta,
): React.ReactNode {
  if (value === undefined || value === null) return "—";
  const fieldName = field.name;
  const fieldType = field.type;
  const { locale, t, fmt } = ctx;

  const str = String(value);

  // A declared display format is the author's choice and wins over the
  // schema type (a `datetime` field declared `format: date` shows the date).
  if (field.format) return formatValue(value, field.format, fmt);

  switch (fieldType) {
    case "image": {
      // The declared type IS the truth: an `image` field renders as an image,
      // extension or not (mock-seeded picsum URLs carry none — the old regex
      // gate showed them as raw text).
      if (!str) return "—";
      return (
        <Box className="mt-1 max-w-full max-h-64">
          <Image src={str} alt={formatFieldLabel(fieldName)} fit="contain" rounded="md" />
        </Box>
      );
    }

    case "url": {
      // A url renders as a link; an image is declared as an `image` field.
      if (/^https?:\/\//i.test(str)) {
        return (
          <a
            href={str}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline break-all"
          >
            {str}
          </a>
        );
      }
      return str;
    }

    case "markdown":
    case "richtext":
      return (
        <Suspense fallback={<Typography variant="body" className="break-words">{str}</Typography>}>
          <Box
            className="prose prose-sm max-w-none"
            style={{
              color: 'var(--color-foreground)',
              '--tw-prose-body': 'var(--color-foreground)',
              '--tw-prose-headings': 'var(--color-foreground)',
              '--tw-prose-bold': 'var(--color-foreground)',
              '--tw-prose-links': 'var(--color-primary)',
              '--tw-prose-code': 'var(--color-foreground)',
              '--tw-prose-hr': 'var(--color-border)',
              '--tw-prose-quotes': 'var(--color-foreground)',
              '--tw-prose-quote-borders': 'var(--color-primary)',
              '--tw-prose-captions': 'var(--color-muted-foreground)',
              '--tw-prose-th-borders': 'var(--color-border)',
              '--tw-prose-td-borders': 'var(--color-border)',
            } as React.CSSProperties}
          >
            <ReactMarkdown>{str}</ReactMarkdown>
          </Box>
        </Suspense>
      );

    case "code":
      return (
        <Box className="mt-1 rounded-container bg-muted p-3 overflow-x-auto">
          <pre className="text-sm font-mono whitespace-pre-wrap break-words m-0">
            <code>{str}</code>
          </pre>
        </Box>
      );

    case "html":
      return (
        <Box
          className="mt-1 prose prose-sm max-w-none break-words"
          style={{
            color: 'var(--color-foreground)',
            '--tw-prose-body': 'var(--color-foreground)',
            '--tw-prose-headings': 'var(--color-foreground)',
            '--tw-prose-bold': 'var(--color-foreground)',
            '--tw-prose-links': 'var(--color-primary)',
            '--tw-prose-code': 'var(--color-foreground)',
            '--tw-prose-hr': 'var(--color-border)',
            '--tw-prose-quotes': 'var(--color-foreground)',
            '--tw-prose-quote-borders': 'var(--color-primary)',
            '--tw-prose-captions': 'var(--color-muted-foreground)',
            '--tw-prose-th-borders': 'var(--color-border)',
            '--tw-prose-td-borders': 'var(--color-border)',
          } as React.CSSProperties}
        >
          <Typography variant="body">{str}</Typography>
        </Box>
      );

    case "date":
    case "datetime":
    case "timestamp": {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(locale, {
          year: "numeric",
          month: "long",
          day: "numeric",
          ...(fieldType !== "date" ? { hour: "2-digit", minute: "2-digit" } : {}),
        });
      }
      return str;
    }

    case "money": {
      const n = typeof value === "number" ? value : Number(str);
      if (!isNaN(n)) {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
        }).format(n);
      }
      return str;
    }

    case "relation": {
      // Resolve to display names via the shared owner: a hydrated row (or
      // array of rows, from `include:`) reads by name/title/label; a bare
      // foreign id resolves through the injected relation options (same
      // {value, label} contract as Form's selects). Never "[object Object]",
      // never a raw id when a label is knowable.
      const labels = relationDisplayLabels(value, meta?.options);
      if (labels.length === 0) return "—";
      if (labels.length === 1) return labels[0];
      return (
        <HStack gap="xs" wrap>
          {labels.map((label, i) => (
            <Badge key={i} variant="default">
              {label}
            </Badge>
          ))}
        </HStack>
      );
    }

    case "file": {
      // A file field holds the canonical {name, url, mimeType, sizeBytes}
      // struct — render a download chip, never the raw object.
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const file = value as { name?: string; url?: string; sizeBytes?: number };
        const label = typeof file.name === "string" && file.name ? file.name : "file";
        const size = typeof file.sizeBytes === "number" ? ` · ${formatFileSize(file.sizeBytes)}` : "";
        return (
          <a
            href={typeof file.url === "string" ? file.url : undefined}
            download={label}
            className="inline-flex items-center gap-1.5 rounded-interactive border border-border bg-muted px-2 py-1 text-sm text-foreground no-underline hover:bg-accent hover:text-accent-foreground"
          >
            <Icon icon={FileText} size="sm" className="text-muted-foreground" />
            {label}
            {size && (
              <Typography as="span" variant="caption" color="muted">
                {size}
              </Typography>
            )}
          </a>
        );
      }
      return str;
    }

    case "boolean": {
      if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
      if (str === "true") return t("common.yes");
      if (str === "false") return t("common.no");
      return str;
    }

    case "array": {
      if (Array.isArray(value) && value.length > 0) {
        return (
          <HStack gap="xs" wrap>
            {value.map((item, i) => (
              <Badge key={i} variant="default">
                {String(item)}
              </Badge>
            ))}
          </HStack>
        );
      }
      if (Array.isArray(value)) return "—";
      return str;
    }

    case "email":
      return (
        <a href={`mailto:${str}`} className="text-primary hover:underline break-all">
          {str}
        </a>
      );

    case "phone":
      return (
        <a href={`tel:${str}`} className="text-primary hover:underline">
          {str}
        </a>
      );

    default:
      // A field with a schema-declared closed vocabulary (a `.lolo` string
      // union) renders as a Badge — its value is a state, not prose.
      if (meta?.values && meta.values.length > 0 && meta.values.includes(str)) {
        return (
          <Badge variant={badgeVariantFor(str, field.colorMap)}>
            {valueLabelFor(str, field.labels)}
          </Badge>
        );
      }
      return formatPlain(value, field.format, fmt);
  }
}

export interface DetailField {
  label: string;
  value: React.ReactNode;
  icon?: IconInput;
  copyable?: boolean;
}

export interface DetailSection {
  title: string;
  fields: (DetailField | string)[];
}

/**
 * Action definition for DetailPanel
 */
export interface DetailPanelAction {
  label: string;
  icon?: IconInput;
  onClick?: () => void;
  /** Event to emit via event bus. `EventKey`, not `string`: the pattern
   *  parser tags an array prop as `kind: "event-list"` only when its element
   *  interface types the event field this way, and that tag is what makes an
   *  authored `events { EDIT: X }` rename fold into these config literals. */
  event?: EventKey;
  /** Navigation URL */
  navigatesTo?: string;
  /** Button variant (primary for main action, others for secondary) */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Condition over the panel's record, authored as `(fn row <bool>)`: the button is drawn only when it returns true. Omit = always shown. */
  when?: RowActionCondition;
  /** Extra data the action sends, authored as `(fn row { key: <expr> })`; it emits `{ id, row }` plus these keys. Omit = `{ id, row }`. */
  payload?: RowActionPayload;
}

/** Schema metadata the runtime's detail enrichment (UISlotRenderer) or the
 *  compiled path's codegen injects onto a field. */
export interface DetailFieldSchema {
  type?: string;
  values?: readonly string[];
  relation?: DetailRelationMeta;
}

/**
 * Field definition: a plain name, a declared {@link DisplayField} (name, label,
 * variant, format, colorMap), or the legacy {key, header} spelling. Every slot a
 * field fills — title (`h3`/`h4`), header badge (`badge`), progress bar
 * (`progress`), prose block (`body`), date, metric — is declared here.
 */
export type FieldDef =
  | string
  | (DisplayField & DetailFieldSchema)
  | (Pick<DisplayField, "variant" | "format" | "colorMap"> & DetailFieldSchema & { key: string; header?: string });

/** A field after normalization: its declared display shape plus injected schema metadata. */
type ResolvedField = DisplayField & DetailFieldSchema;

interface RenderContext {
  locale: string;
  t: TranslateFunction;
  fmt: FormatContext;
}

function resolveFields(fields: readonly FieldDef[] | undefined): ResolvedField[] {
  const out: ResolvedField[] = [];
  for (const f of fields ?? []) {
    const base = normalizeDisplayField(f);
    if (!base) continue;
    out.push(typeof f === "string" ? base : { ...base, variant: f.variant, format: f.format, colorMap: f.colorMap, type: f.type, values: f.values, relation: f.relation });
  }
  return out;
}

type FieldSlot = "badge" | "progress" | "body" | "date" | "metric" | "other";

function slotOf(f: ResolvedField): FieldSlot {
  if (f.variant === "badge") return "badge";
  if (f.variant === "progress") return "progress";
  if (f.variant === "body") return "body";
  if (f.format === "date" || f.format === "datetime") return "date";
  if (f.format === "currency" || f.format === "number" || f.format === "percent") return "metric";
  return "other";
}

export interface DetailPanelStatus {
  label: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

/**
 * Props for DetailPanel — the generic read-only record detail view.
 *
 * @fieldsContract display
 */
export interface DetailPanelProps extends DisplayStateProps, A11yProps {
  /** Skeleton drawn while loading, and the shape an empty slot shows while this element's server render is in flight (`none` opts out). */
  skeleton?: SkeletonSpec;
  /** RECORD-cardinality: renders ONE record (see body collapse below). */
  entity?: EntityRow;
  title?: string;
  /**
   * When bound, the title becomes editable in place: clicking it swaps the
   * heading for an input, Enter or blur commits, Escape reverts. Receives the
   * committed title and the record's id so the host can persist a partial
   * update. Unbound, the title stays a plain heading.
   * @offByDefault
   */
  onTitleCommit?: (title: string, id: string) => void;
  subtitle?: string;
  status?: DetailPanelStatus;
  avatar?: React.ReactNode;
  sections?: readonly DetailSection[];
  /** Unified actions array - first action with variant='primary' is the main action */
  actions?: readonly DetailPanelAction[];
  /** Max inline action buttons before the rest collapse into a "⋯" overflow
   *  menu (mirrors DataGrid's maxInlineActions). Defaults to 2 — primary +
   *  secondary visible, the rest under the menu — so every detail panel
   *  carries the same action pattern. */
  maxInlineActions?: number;
  /**
   * Navigation-back affordance. Renders top-LEFT before the title (OS/back
   * convention — Almadar_UX §8.4), spatially separated from the right-aligned
   * action buttons + close X. Never inferred from actions[] labels.
   */
  backAction?: DetailPanelAction;
  /**
   * The event of the declared action that dismisses the panel. The matching
   * action renders as the header close ×; omitted, no × is drawn.
   */
  closeEvent?: EventKey;
  footer?: React.ReactNode;
  slideOver?: boolean;
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. Inline mode only; the slide-over is itself a surface. */
  surface?: SurfaceMode;

  /** Fields to display: field names, or declared fields ({ name, label, variant, format, colorMap, labels }) */
  fields: readonly (FieldDef | DetailField)[];
  /** Alias for fields - backwards compatibility */
  fieldNames?: readonly string[];
  /** Initial data for edit mode (passed by compiler) */
  initialData?: EntityRow;
  /** Display mode (passed by compiler) */
  mode?: string;
  /** Panel position (for drawer/sidebar placement) */
  position?: "left" | "right";
  /** Panel width (CSS value, e.g., '400px', '50%') */
  width?: string;
  /** Display fields (alias for fields) */
  displayFields?: readonly string[];
  /** When false, hides the action buttons + overflow menu (and the close ×).
   *  Defaults to true. */
  showActions?: boolean;
  /** Relation display data: { fieldName: [{value, label}] } — injected
   *  server-side by the runtime (relation-option injection) or bound by
   *  compiled codegen; resolves stored foreign ids to display names. */
  relationsData?: Record<string, readonly RelationOption[]>;
  /** Page variant: panel (labelled fields, default), profile (person/member hero), showcase (image-first product/listing), workflow (lifecycle stepper + activity), map (location hero), ledger (document with line items + totals), conversation (thread beside the record), workspace (tabbed record). */
  look?: DetailLook;
  /** Record field holding the avatar image. The profile look always shows an avatar, with the title's initials when this is unset or empty. */
  avatarField?: string;
  /** Record field holding the cover image (profile). */
  coverField?: string;
  /** Record field holding the image, or list of images, the showcase look leads with. */
  mediaField?: string;
  /** Record field holding the current lifecycle stage (workflow). */
  stageField?: string;
  /** The lifecycle in order, `{ value, label }` per stage (workflow). */
  stages?: readonly DetailStage[];
  /** Activity entries shown under the record (workflow). */
  activity?: readonly TimelineItem[];
  /** Activity composed in instead of `activity` — e.g. the record's own history trait (workflow). */
  activityContent?: React.ReactNode;
  /** Record fields holding the location (map). */
  latitudeField?: string;
  longitudeField?: string;
  /** Child rows shown as the document's line items (ledger). */
  lineItems?: readonly EntityRow[];
  /** Columns of the line-items table (ledger). */
  lineItemColumns?: readonly TableViewColumn[];
  /** Line items composed in instead of `lineItems` — e.g. the child rows' own trait (ledger). */
  lineItemsContent?: React.ReactNode;
  /** Record fields shown as the document's totals, in order (ledger). */
  totals?: readonly FieldDef[];
  /** The thread shown as the main surface (conversation). */
  thread?: readonly EntityWith<ReplyNodeRow>[];
  /** The thread composed in instead of `thread` — e.g. the replies' own trait with its composer (conversation). */
  threadContent?: React.ReactNode;
  /** Tabs after the overview tab, each listing declared field names (workspace). */
  tabs?: readonly DetailTab[];
}

export const DetailPanel: React.FC<DetailPanelProps> = ({
  title: propTitle,
  onTitleCommit,
  subtitle,
  status,
  avatar,
  sections: propSections,
  actions,
  maxInlineActions = 2,
  backAction,
  closeEvent,
  footer,
  slideOver = false,
  surface = 'auto',
  showActions = true,
  className,
  entity,
  fields: propFields,
  fieldNames,
  initialData,
  isLoading = false,
  skeleton = 'detail',
  error,
  relationsData,
  look = "panel",
  avatarField,
  coverField,
  mediaField,
  stageField,
  stages,
  activity,
  latitudeField,
  longitudeField,
  lineItems,
  lineItemColumns,
  lineItemsContent,
  totals,
  thread,
  threadContent,
  activityContent,
  tabs,
  ...a11yRest
}) => {
  const contentSurface = useContentSurface(surface);
  const eventBus = useEventBus();
  const navigateStack = useNavStack();
  const rowActions = useRowActions();
  const actionPayload = useRowActionPayload();
  const { t, locale } = useTranslate();
  const fmt = useFormatContext();
  const ctx: RenderContext = { locale, t, fmt };
  // Inside a contained preview (playground/builder canvas card) a portaled
  // slide-over would dock to the host viewport instead of the preview box.
  const contained = useContext(SlotContainedContext);
  // null = not editing; a string = the in-flight title draft.
  const [titleDraft, setTitleDraft] = React.useState<string | null>(null);

  // Support fields and fieldNames (alias) - normalize to string array
  // Check if propFields contains FieldDef (string or {key}) or DetailField (has label/value)
  const isFieldDefArray = (
    arr: readonly (FieldDef | DetailField)[] | undefined,
  ): arr is readonly FieldDef[] => {
    if (!arr || arr.length === 0) return false;
    const first = arr[0];
    return (
      typeof first === "string" ||
      (typeof first === "object" && first !== null && ("key" in first || "name" in first))
    );
  };

  const resolvedFields: ResolvedField[] | undefined = isFieldDefArray(propFields)
    ? resolveFields(propFields)
    : fieldNames?.map((name) => ({ name }));
  const fieldByName = new Map((resolvedFields ?? []).map((f) => [f.name, f]));
  const fieldFor = (name: string): ResolvedField => fieldByName.get(name) ?? { name };
  const labelFor = (name: string): string => fieldByName.get(name)?.label ?? formatFieldLabel(name);

  // Schema metadata + relation options merged per field for typed rendering.
  const metaFor = (field: ResolvedField): FieldMeta | undefined => {
    const hasSchema = field.type !== undefined || field.values !== undefined || field.relation !== undefined;
    const options = relationsData?.[field.name];
    if (!hasSchema && !options) return undefined;
    return { type: field.type, values: field.values, relation: field.relation, options };
  };
  const richValue = (field: ResolvedField, value: FieldValue | undefined): React.ReactNode =>
    renderRichFieldValue(value, field, ctx, metaFor(field));

  // Handle action click with event bus and navigation support
  // An overflow-menu action closes its menu, so the trigger it came from shows busy.
  const overflowBusy = usePendingAction();
  const handleActionClick = useCallback(
    (action: DetailPanelAction, record?: EntityRow, pendingKey?: string) => {
      if (action.navigatesTo) {
        // Replace template variables in URL
        const url = action.navigatesTo.replace(/\{\{(\w+)\}\}/g, (_, key) =>
          String(record?.[key] ?? ""),
        );
        navigateStack.goTo(url);
        return;
      }
      if (action.event) {
        eventBus.emit(`UI:${action.event}`, record ? actionPayload(action, record) : {}, pendingKey !== undefined ? { pendingKey } : undefined);
      }
      if (action.onClick) {
        action.onClick();
      }
    },
    [eventBus, navigateStack, actionPayload],
  );

  // entity is now the data itself (single record or first element of array)
  const entityRecord = Array.isArray(entity) ? entity[0] : entity;
  const data = entityRecord ?? initialData;

  let title = propTitle;
  // Use a mutable array for building sections, but accept readonly from props
  const hasDeclaredSections = Boolean(propSections && propSections.length > 0);
  let sections: DetailSection[] | undefined = hasDeclaredSections && propSections
    ? [...propSections]
    : undefined;

  // Normalize data to EventPayload for indexing and payload propagation
  const normalizedData =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as EventPayload)
      : undefined;

  // Resolve string fields in sections using entity data
  if (sections && normalizedData) {
    sections = sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (typeof field === "string") {
          const value = getNestedValue(normalizedData, field) as FieldValue | undefined;
          return {
            label: labelFor(field),
            value: formatPlain(value, fieldFor(field).format, fmt),
          };
        }
        return field;
      }),
    }));
  }

  let keyFigures: ResolvedField[] = [];
  let proseFields: DetailField[] = [];

  // Build sections from schema if provided
  if (normalizedData && resolvedFields) {
    const declaredTitle = titleFieldOf(resolvedFields);
    const titleDerived = Boolean(
      !title && declaredTitle && getNestedValue(normalizedData, declaredTitle.name),
    );
    if (titleDerived && declaredTitle) {
      title = String(getNestedValue(normalizedData, declaredTitle.name));
    }

    // A workspace tab claims its fields; the Overview tab leaves them out.
    const tabClaimed = new Set(look === "workspace" ? (tabs ?? []).flatMap((tab) => tab.fields ?? []) : []);
    const slotted = (slot: FieldSlot): ResolvedField[] =>
      resolvedFields.filter((f) => slotOf(f) === slot && !(titleDerived && f === declaredTitle) && !tabClaimed.has(f.name));
    const progressFields = slotted("progress");
    const metricFields = slotted("metric");
    const dateFields = slotted("date");
    const descriptionFields = slotted("body");
    const otherFields = slotted("other");

    const toDetailFields = (group: readonly ResolvedField[]): DetailField[] => {
      const out: DetailField[] = [];
      for (const field of group) {
        const value = getNestedValue(normalizedData, field.name) as FieldValue | undefined;
        if (value !== undefined && value !== null) {
          out.push({ label: labelFor(field.name), value: richValue(field, value) });
        }
      }
      return out;
    };

    // Badge-variant fields are DELIBERATELY withheld — they already render as
    // badges beside the title; repeating them as grid rows showed the same
    // value twice on 53 of 79 surveyed detail pages. Money/number/percent and
    // progress fields go to the key-figures strip, prose to its own block.
    // Declared `sections` are the author's grouping and win over the field slots.
    if (!hasDeclaredSections) {
      sections = [];
      const overviewFields = toDetailFields(otherFields);
      if (overviewFields.length > 0) sections.push({ title: t("detailPanel.section.overview"), fields: overviewFields });
      const timelineFields = toDetailFields(dateFields);
      if (timelineFields.length > 0) sections.push({ title: t("detailPanel.section.timeline"), fields: timelineFields });
    }

    keyFigures = [...progressFields, ...metricFields].filter((field) => {
      const value = getNestedValue(normalizedData, field.name);
      return value !== undefined && value !== null && value !== "";
    });
    proseFields = toDetailFields(descriptionFields);
  }

  // Feed the loaded record's title into the nav stack's current crumb, so a
  // cold-loaded/refreshed detail page reads like an in-app push ("Contracts
  // › Service Agreement", not "Contracts › Contract Detail"). Only from the
  // routed MAIN slot — a modal/drawer/slide-over must not relabel the page's
  // crumb — and a no-op outside a NavStackProvider (inert default API).
  const renderSlot = useRenderSlot();
  const navStack = useNavStack();
  const { setCurrentLabel } = navStack;
  const resolvedTitle = normalizedData ? title : undefined;
  useEffect(() => {
    if (renderSlot === "main" && !slideOver && resolvedTitle) {
      setCurrentLabel(resolvedTitle);
    }
  }, [renderSlot, slideOver, resolvedTitle, setCurrentLabel]);

  if (isLoading) {
    return (
      <Skeleton spec={skeleton} className={className} />
    );
  }

  if (error) {
    return (
      <ErrorState
        title={t("error.loadingData")}
        message={error.message || t("error.genericLoad")}
        retryEvent="RETRY"
        className={className}
      />
    );
  }

  if (
    !normalizedData &&
    !isLoading &&
    resolvedFields &&
    resolvedFields.length > 0
  ) {
    return (
      <EmptyState
        title={t('error.notFound')}
        description={t('display.itemNotFound')}
        className={className}
      />
    );
  }

  // Resolve string field references inside sections; sections keep their own headings.
  const renderedSections: { title: string; fields: DetailField[] }[] = (sections ?? [])
    .map((section) => ({
      title: section.title,
      fields: section.fields.map((field): DetailField => {
        if (typeof field !== "string") return field;
        const value = (normalizedData ? getNestedValue(normalizedData, field) : undefined) as FieldValue | undefined;
        return { label: labelFor(field), value: richValue(fieldFor(field), value) };
      }),
    }))
    .filter((section) => section.fields.length > 0);
  const showSectionHeadings = renderedSections.length > 1;

  // The close × renders ONLY for the action whose event the call site names
  // in `closeEvent` — a routed detail page names none and gets no dismiss
  // affordance (the shell's Back owns navigation there).
  const shownActions = rowActions(actions ?? [], data ?? {});
  const closeAction = closeEvent ? shownActions.find((a) => a.event === closeEvent) : undefined;
  const otherActions = shownActions.filter((a) => a !== closeAction);

  const statusBadges = (
    <>
      {normalizedData &&
        resolvedFields &&
        resolvedFields
          .filter((f) => slotOf(f) === "badge")
          .map((field) => {
            const value = getNestedValue(normalizedData, field.name);
            if (value === undefined || value === null || value === "") return null;
            return (
              <Badge
                key={field.name}
                variant={badgeVariantFor(String(value), field.colorMap)}
              >
                {valueLabelFor(String(value), field.labels)}
              </Badge>
            );
          })}
      {status && (
        <Badge variant={status.variant ?? "default"}>
          {status.label}
        </Badge>
      )}
    </>
  );

  // Editable title (only when a host bound onTitleCommit). A blank draft, or
  // one equal to the current title, closes the editor without a commit — the
  // record keeps the name it had rather than being silently emptied.
  const commitTitle = () => {
    if (!onTitleCommit) return;
    const next = (titleDraft ?? "").trim();
    setTitleDraft(null);
    if (!next || next === title) return;
    onTitleCommit(next, normalizedData?.id !== undefined ? String(normalizedData.id) : "");
  };

  const titleNode =
    onTitleCommit && titleDraft !== null ? (
      <Input
        value={titleDraft}
        autoFocus
        aria-label={t("common.title")}
        className="h-auto py-1 heading-voice text-3xl"
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitTitle();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setTitleDraft(null);
          }
        }}
        data-testid="detail-title-input"
      />
    ) : onTitleCommit ? (
      <Box
        role="button"
        tabIndex={0}
        className="cursor-text rounded-interactive px-1 -mx-1 transition-colors hover:bg-muted/40"
        onClick={() => setTitleDraft(title ?? "")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setTitleDraft(title ?? "");
          }
        }}
        data-testid="detail-title-editable"
      >
        <Typography variant="h2">
          {title || t("display.details")}
        </Typography>
      </Box>
    ) : (
      <Typography variant="h2">
        {title || t("display.details")}
      </Typography>
    );

  const avatarSrc = avatarField && normalizedData ? getNestedValue(normalizedData, avatarField) : undefined;
  const avatarNode = avatar ?? (avatarField || look === "profile" ? (
    <Avatar src={typeof avatarSrc === "string" && avatarSrc ? avatarSrc : undefined} name={title} size="xl" />
  ) : null);

  const totalFields = resolveFields(totals);
  const totalsNode = totalFields.length > 0 && normalizedData ? (
    <VStack gap="xs" align="end" className="ms-auto min-w-[16rem] border-t border-border pt-3" data-testid="detail-totals">
      {totalFields.map((field, idx) => {
        const value = getNestedValue(normalizedData, field.name) as FieldValue | undefined;
        const last = idx === totalFields.length - 1;
        return (
          <HStack key={field.name} justify="between" gap="lg" className="w-full">
            <Typography variant={last ? "body" : "small"} color={last ? undefined : "secondary"} weight={last ? "semibold" : undefined}>
              {field.label ?? field.name}
            </Typography>
            <Typography variant={last ? "h4" : "body"} as="span" className="tabular-nums">
              {value === undefined || value === null ? "—" : formatValue(value, field.format, fmt)}
            </Typography>
          </HStack>
        );
      })}
    </VStack>
  ) : null;

  // minChildWidth = Tailwind w-48 (was 200px)
  const renderFields = (names: readonly string[]): React.ReactNode => (
    <SimpleGrid minChildWidth="192px" maxCols={3} gap="md">
      {names.map((name) => {
        const value = (normalizedData ? getNestedValue(normalizedData, name) : undefined) as FieldValue | undefined;
        return (
          <VStack key={name} gap="none" className="min-w-0">
            <Typography variant="caption" color="muted" weight="medium">{labelFor(name)}</Typography>
            <Typography variant="body" className="break-words">{richValue(fieldFor(name), value)}</Typography>
          </VStack>
        );
      })}
    </SimpleGrid>
  );

  const headerNode = (
    <>
        {/* One-row header: identity LEFT (back per OS convention, then
            avatar + title with its status badges + subtitle), actions RIGHT
            (inline up to maxInlineActions, rest in the ⋯ menu, gated ×). */}
        <HStack justify="between" align="start" gap="md" wrap className={slideOver ? "sticky top-0 z-10 -mx-6 -mt-6 bg-card px-6 pt-6 pb-3 border-b border-border" : undefined}>
          <HStack align="start" gap="sm" className="min-w-0 flex-1">
            {backAction && (
              <Button
                variant={backAction.variant || "ghost"}
                size="sm"
                action={backAction.navigatesTo ? undefined : backAction.event}
                actionPayload={data ? actionPayload(backAction, data) : undefined}
                onClick={backAction.navigatesTo ? () => handleActionClick(backAction, data) : undefined}
                icon={backAction.icon ?? ArrowLeft}
                data-testid={backAction.event ? actionTestId(backAction.event) : actionTestId("back")}
              >
                {backAction.label}
              </Button>
            )}
            {avatarNode}
            <VStack gap="xs" className="min-w-0">
              <HStack align="center" gap="sm" wrap>
                {titleNode}
                {statusBadges}
              </HStack>
              {subtitle && (
                <Typography variant="body" color="secondary">
                  {subtitle}
                </Typography>
              )}
            </VStack>
          </HStack>
          {showActions && (
            <HStack justify="end" align="center" gap="xs" className="shrink-0">
              {otherActions.slice(0, maxInlineActions).map((action, idx) => (
                <Button
                  key={idx}
                  variant={action.variant || "secondary"}
                  size="sm"
                  action={action.navigatesTo ? undefined : action.event}
                  actionPayload={data ? actionPayload(action, data) : undefined}
                  onClick={action.navigatesTo ? () => handleActionClick(action, data) : undefined}
                  icon={action.icon}
                  data-testid={action.event ? actionTestId(action.event) : undefined}
                  data-row-id={normalizedData?.id !== undefined ? String(normalizedData.id) : undefined}
                >
                  {action.label}
                </Button>
              ))}
              {otherActions.length > maxInlineActions && (
                <Menu
                  position="bottom-end"
                  trigger={
                    <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid={ACTION_OVERFLOW_TESTID} isLoading={overflowBusy.pending}>
                      <Icon name="more-horizontal" size="xs" />
                    </Button>
                  }
                  items={otherActions.slice(maxInlineActions).map((action) => ({
                    // ONE firing path: onClick → handleActionClick (emits with
                    // the {id, row} payload). Passing `event` too would make
                    // Menu emit a second, payload-less copy of the same event.
                    label: action.label,
                    icon: action.icon,
                    variant: action.variant === "danger" ? ("danger" as const) : ("default" as const),
                    onClick: () => overflowBusy.activate((pendingKey) => handleActionClick(action, data, pendingKey)),
                  }))}
                />
              )}
              {closeAction && (
                <Button
                  variant="ghost"
                  size="sm"
                  action={closeAction.event}
                  actionPayload={data ? actionPayload(closeAction, data) : undefined}
                  onClick={closeAction.event ? undefined : () => handleActionClick(closeAction, data)}
                  icon={X}
                  aria-label={t("aria.closePanel")}
                  data-testid={closeAction.event ? actionTestId(closeAction.event) : actionTestId("close")}
                />
              )}
            </HStack>
          )}
        </HStack>
    </>
  );
  const figuresNode = (
    <>
        {keyFigures.length > 0 && normalizedData && (
          <HStack gap="md" wrap align="stretch" data-testid="detail-key-figures">
            {keyFigures.map((field) => {
              const value = getNestedValue(normalizedData, field.name) as FieldValue;
              return (
                <VStack key={field.name} gap="xs" className="min-w-[10rem] max-w-[18rem] flex-1 rounded-container border border-border bg-muted/30 p-3">
                  <Typography variant="caption" color="muted" weight="medium">
                    {labelFor(field.name)}
                  </Typography>
                  <Typography variant="h4" as="p" className="tabular-nums break-words">
                    {formatValue(value, field.format, fmt)}
                  </Typography>
                  {slotOf(field) === "progress" && typeof value === "number" && <ProgressBar value={value} />}
                </VStack>
              );
            })}
          </HStack>
        )}
    </>
  );
  const sectionsNode = (
    <>
        {renderedSections.length > 0 && (
          <VStack gap="lg" data-testid="detail-fields">
            {renderedSections.map((section, sIdx) => (
              <VStack key={sIdx} gap="sm">
                {showSectionHeadings && (
                  <Typography variant="h5" as="h3" color="secondary">
                    {section.title}
                  </Typography>
                )}
                {/* minChildWidth = Tailwind w-48 (was 200px) */}
                <SimpleGrid minChildWidth="192px" maxCols={3} gap="md">
                  {section.fields.map((field, idx) => (
                    <HStack key={idx} gap="sm" align="start" className="min-w-0">
                      {field.icon && (
                        <Icon icon={field.icon} size="md" className="text-muted-foreground mt-1" />
                      )}
                      <VStack gap="none" flex className="min-w-0">
                        <Typography variant="caption" color="muted" weight="medium">
                          {field.label}
                        </Typography>
                        <Typography variant="body" className="break-words">
                          {field.value || "—"}
                        </Typography>
                      </VStack>
                    </HStack>
                  ))}
                </SimpleGrid>
              </VStack>
            ))}
          </VStack>
        )}
    </>
  );
  const proseNode = (
    <>
        {proseFields.length > 0 && (
          <VStack gap="md" data-testid="detail-prose">
            {proseFields.map((field, idx) => (
              <VStack key={idx} gap="xs">
                <Typography variant="caption" color="muted" weight="medium">
                  {field.label}
                </Typography>
                <Typography variant="body" className="whitespace-pre-line break-words">
                  {field.value}
                </Typography>
              </VStack>
            ))}
          </VStack>
        )}
    </>
  );
  const footerNode = (
    <>
        {footer && (
          <>
            <Divider />
            {footer}
          </>
        )}
    </>
  );
  const content = (
    <Box className={slideOver ? undefined : "p-6"}>
      <DetailLookLayout
        look={look}
        record={data}
        title={title}
        regions={{ coverField, mediaField, stageField, stages, activity, activityContent, latitudeField, longitudeField, lineItems, lineItemColumns, lineItemsContent, thread, threadContent, tabs }}
        pieces={{ header: headerNode, figures: figuresNode, sections: sectionsNode, prose: proseNode, footer: footerNode, totals: totalsNode, renderFields }}
      />
    </Box>
  );

  if (!slideOver) {
    return (
      <Box {...domPassthrough(a11yRest)} className={className}>
        {contentSurface.provide(
          <Box className={cn(contentSurface.className, "rounded-container")} data-testid="detail-card">
            {content}
          </Box>,
        )}
      </Box>
    );
  }

  // Portal into the theme-synced portal root, for the same reason Modal does:
  // `position: fixed` is resolved against the nearest ancestor that
  // establishes containment, and DashboardLayout's root carries
  // `@container/dashboard` (`contain: layout`), so an in-place slide-over was
  // laid out against that container and painted off-screen.
  // The scrim dismisses through the declared closeEvent only; the panel is
  // the surface itself — no card inside it.
  const dismiss = closeAction ? () => handleActionClick(closeAction, data) : undefined;
  const panel = (
    <>
      <Box
        className={cn(contained ? "absolute" : "fixed", "inset-0 z-40 bg-scrim")}
        onClick={dismiss}
        aria-hidden="true"
        data-testid="detail-scrim"
      />
      <Box
        {...domPassthrough(a11yRest)}
        role="dialog"
        aria-modal="true"
        aria-label={a11yRest["aria-label"] ?? (title || t("display.details"))}
        className={cn(contained ? "absolute" : "fixed", "inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto bg-card surface-material shadow-elevation-dialog p-6", className)}
        data-testid="detail-slide-over"
      >
        <SurfaceBoundary>{content}</SurfaceBoundary>
      </Box>
    </>
  );
  // Contained previews render inline against the UISlotRenderer root (relative);
  // only real app pages portal to the shared root.
  if (contained || typeof document === "undefined") return panel;
  return (<ThemedPortal>{panel}</ThemedPortal>);
};

DetailPanel.displayName = "DetailPanel";
