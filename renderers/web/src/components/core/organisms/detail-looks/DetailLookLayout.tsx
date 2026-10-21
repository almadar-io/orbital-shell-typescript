/**
 * Page variants of a record detail. DetailPanel computes the pieces of a
 * record page (header, key figures, field sections, prose, footer) and the
 * declared region data; a look only ARRANGES them, composing the existing
 * core components — it never fetches and never infers a region from data.
 */
import React, { useState } from 'react';
import { isFileValue, type EntityRow, type EntityWith, type FieldValue } from '@almadar/core';
import { Box } from '../../../../core';
import { Button } from '../../../../core';
import { Image } from '../../../../core';
import { Typography } from '../../../../core';
import { HStack, VStack } from '../../../../core';
import { Lightbox, type LightboxImage } from '../../molecules/Lightbox';
import { MapView } from '../../molecules/MapView';
import { Tabs } from '../../molecules/Tabs';
import { WizardProgress } from '../../molecules/WizardProgress';
import { ReplyTree, type ReplyNodeRow } from '../../molecules/ReplyTree';
import { TableView, type TableViewColumn } from '../../molecules/TableView';
import { Timeline, type TimelineItem } from '../Timeline';
import { getNestedValue } from '../../../../lib/getNestedValue';
import { useTranslate } from '../../../../core';

/**
 * panel = labelled-field record (default) · profile = person/member hero ·
 * showcase = image-first product/listing · workflow = lifecycle stepper +
 * activity (+ declared line items) · map = location hero · ledger = document with line items and
 * totals · conversation = thread beside the record facts · workspace = tabbed
 * record.
 */
export type DetailLook = 'panel' | 'profile' | 'showcase' | 'workflow' | 'map' | 'ledger' | 'conversation' | 'workspace';

/** One stage of a declared lifecycle, in order. */
export interface DetailStage {
  value: string;
  label: string;
}

/** One workspace tab: the declared fields it shows, or content composed in (e.g. a related list's trait). */
export interface DetailTab {
  id: string;
  label: string;
  fields?: readonly string[];
  content?: React.ReactNode;
}

/** Region data a look reads — every member is declared by the author. */
export interface DetailLookRegions {
  /** Record field holding the cover image (profile). */
  coverField?: string;
  /** Record field holding the image, or images, the showcase look leads with. */
  mediaField?: string;
  /** Record field holding the current lifecycle stage (workflow). */
  stageField?: string;
  /** The lifecycle, in order (workflow). */
  stages?: readonly DetailStage[];
  /** Activity entries shown under the record (workflow). */
  activity?: readonly TimelineItem[];
  /** Activity composed in instead of `activity` (e.g. the record's own history trait). */
  activityContent?: React.ReactNode;
  /** Record fields holding the location (map). */
  latitudeField?: string;
  longitudeField?: string;
  /** Child rows shown as the document's line items (ledger). */
  lineItems?: readonly EntityRow[];
  lineItemColumns?: readonly TableViewColumn[];
  /** Line items composed in instead of `lineItems` (e.g. the child rows' own trait). */
  lineItemsContent?: React.ReactNode;
  /** The thread shown as the main surface (conversation). */
  thread?: readonly EntityWith<ReplyNodeRow>[];
  /** The thread composed in instead of `thread` (e.g. the replies' own trait, with its composer). */
  threadContent?: React.ReactNode;
  /** Tabs after the overview tab (workspace). */
  tabs?: readonly DetailTab[];
}

export interface DetailLookPieces {
  header: React.ReactNode;
  figures: React.ReactNode;
  sections: React.ReactNode;
  prose: React.ReactNode;
  footer: React.ReactNode;
  /** Ledger totals block (record fields declared as totals, already formatted). */
  totals: React.ReactNode;
  /** Renders the named declared fields as a labelled grid (workspace tabs). */
  renderFields: (names: readonly string[]) => React.ReactNode;
}

export interface DetailLookLayoutProps {
  look: DetailLook;
  record: EntityRow | undefined;
  title: string | undefined;
  regions: DetailLookRegions;
  pieces: DetailLookPieces;
}

function fieldString(record: EntityRow | undefined, name: string | undefined): string | undefined {
  if (!record || !name) return undefined;
  const value = getNestedValue(record, name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function fieldNumber(record: EntityRow | undefined, name: string | undefined): number | undefined {
  if (!record || !name) return undefined;
  const value = getNestedValue(record, name);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

/** The media field's value as images: one url, an uploaded image file, or a list of either / of `{ src, caption }`. */
function mediaImages(value: FieldValue | undefined): LightboxImage[] {
  const one = (v: FieldValue): LightboxImage | null => {
    if (typeof v === 'string') return v ? { src: v } : null;
    if (isFileValue(v)) return v.mimeType.startsWith('image/') ? { src: v.url, caption: v.name } : null;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const src = v.src;
      const caption = v.caption;
      return typeof src === 'string' && src ? { src, ...(typeof caption === 'string' ? { caption } : {}) } : null;
    }
    return null;
  };
  if (Array.isArray(value)) return value.map(one).filter((i): i is LightboxImage => i !== null);
  if (value === undefined || value === null) return [];
  const single = one(value);
  return single ? [single] : [];
}

function ShowcaseMedia({ images, title }: { images: LightboxImage[]; title: string | undefined }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const { t } = useTranslate();
  const current = images[Math.min(index, images.length - 1)];
  if (!current?.src) return null;
  return (
    <VStack gap="sm" data-testid="detail-media">
      <Button variant="ghost" className="h-auto p-0 w-full" onClick={() => setOpen(true)} aria-label={t('detailPanel.openImage')}>
        <Image src={current.src} alt={current.alt ?? title ?? ''} aspect="4/3" fit="cover" rounded="lg" />
      </Button>
      {images.length > 1 && (
        <HStack gap="xs" wrap>
          {images.map((img, i) => (
            <Button
              key={img.src ?? i}
              variant="ghost"
              className={i === index ? 'h-auto p-0 ring-2 ring-primary rounded-md' : 'h-auto p-0'}
              onClick={() => setIndex(i)}
              aria-label={t('detailPanel.showImage', { index: i + 1 })}
              aria-pressed={i === index}
            >
              <Box className="w-16">
                <Image src={img.src ?? ''} alt="" aspect="1/1" fit="cover" rounded="md" />
              </Box>
            </Button>
          ))}
        </HStack>
      )}
      <Lightbox images={images} currentIndex={index} isOpen={open} onClose={() => setOpen(false)} onIndexChange={setIndex} />
    </VStack>
  );
}

export const DetailLookLayout: React.FC<DetailLookLayoutProps> = ({ look, record, title, regions, pieces }) => {
  const { t } = useTranslate();
  const { header, figures, sections, prose, footer, totals, renderFields } = pieces;
  const lineItemsNode = (regions.lineItemsContent || (regions.lineItems && regions.lineItemColumns)) ? (
    <VStack gap="sm" data-testid="detail-line-items">
      <Typography variant="h5" as="h3" color="secondary">{t('detailPanel.section.lineItems')}</Typography>
      {regions.lineItemsContent ?? (regions.lineItems && regions.lineItemColumns && (
        <TableView entity={regions.lineItems} columns={regions.lineItemColumns} />
      ))}
    </VStack>
  ) : null;

  if (look === 'profile') {
    const cover = fieldString(record, regions.coverField);
    return (
      <VStack gap="lg" data-testid="detail-look-profile">
        {cover && (
          <Box className="-mx-6 -mt-6 overflow-hidden" data-testid="detail-cover">
            <Image src={cover} alt="" aspect="21/9" fit="cover" />
          </Box>
        )}
        {header}
        {figures}
        {sections}
        {prose}
        {footer}
      </VStack>
    );
  }

  if (look === 'showcase') {
    const images = mediaImages(record && regions.mediaField ? getNestedValue(record, regions.mediaField) as FieldValue : undefined);
    return (
      <VStack gap="lg" data-testid="detail-look-showcase">
        <Box className={images.length > 0 ? 'grid gap-6 md:grid-cols-2' : 'grid gap-6'}>
          <ShowcaseMedia images={images} title={title} />
          <VStack gap="lg">
            {header}
            {figures}
            {sections}
          </VStack>
        </Box>
        {prose}
        {footer}
      </VStack>
    );
  }

  if (look === 'workflow') {
    const stages = regions.stages ?? [];
    const currentValue = fieldString(record, regions.stageField);
    const current = stages.findIndex((s) => s.value === currentValue);
    return (
      <VStack gap="lg" data-testid="detail-look-workflow">
        {header}
        {current >= 0 && (
          <Box data-testid="detail-stages">
            <WizardProgress steps={stages.map((s) => ({ id: s.value, title: s.label }))} currentStep={current} />
          </Box>
        )}
        {figures}
        {sections}
        {lineItemsNode}
        {prose}
        {(regions.activityContent || (regions.activity && regions.activity.length > 0)) && (
          <VStack gap="sm" data-testid="detail-activity">
            <Typography variant="h5" as="h3" color="secondary">{t('detailPanel.section.activity')}</Typography>
            {regions.activityContent ?? (regions.activity && <Timeline items={regions.activity} />)}
          </VStack>
        )}
        {footer}
      </VStack>
    );
  }

  if (look === 'map') {
    const lat = fieldNumber(record, regions.latitudeField);
    const lng = fieldNumber(record, regions.longitudeField);
    const located = lat !== undefined && lng !== undefined;
    return (
      <VStack gap="lg" data-testid="detail-look-map">
        {located && (
          <Box className="-mx-6 -mt-6 overflow-hidden" data-testid="detail-map">
            <MapView
              markers={[{ id: String(record?.id ?? 'record'), lat, lng, label: title }]}
              centerLat={lat}
              centerLng={lng}
              zoom={14}
              height="320px"
            />
          </Box>
        )}
        {header}
        {figures}
        {sections}
        {prose}
        {footer}
      </VStack>
    );
  }

  if (look === 'ledger') {
    return (
      <VStack gap="lg" data-testid="detail-look-ledger" className="print:shadow-none">
        {header}
        {sections}
        {lineItemsNode}
        {totals}
        {figures}
        {prose}
        {footer}
      </VStack>
    );
  }

  if (look === 'conversation') {
    return (
      <VStack gap="lg" data-testid="detail-look-conversation">
        {header}
        <Box className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <VStack gap="md" data-testid="detail-thread">
            {regions.threadContent ?? (regions.thread && regions.thread.length > 0 ? (
              <ReplyTree nodes={regions.thread} showActions={false} />
            ) : (
              <Typography variant="body" color="muted">{t('detailPanel.thread.empty')}</Typography>
            ))}
            {footer}
          </VStack>
          <VStack gap="lg">
            {figures}
            {sections}
            {prose}
          </VStack>
        </Box>
      </VStack>
    );
  }

  if (look === 'workspace') {
    const overview = (
      <VStack gap="lg">
        {figures}
        {sections}
        {prose}
      </VStack>
    );
    const items = [
      { id: 'overview', label: t('detailPanel.tab.overview'), content: overview },
      ...(regions.tabs ?? []).map((tab) => ({ id: tab.id, label: tab.label, content: tab.content ?? renderFields(tab.fields ?? []) })),
    ];
    return (
      <VStack gap="lg" data-testid="detail-look-workspace">
        {header}
        <Tabs items={items} defaultActiveTab="overview" variant="underline" />
        {footer}
      </VStack>
    );
  }

  return (
    <VStack gap="lg">
      {header}
      {figures}
      {sections}
      {prose}
      {footer}
    </VStack>
  );
};
