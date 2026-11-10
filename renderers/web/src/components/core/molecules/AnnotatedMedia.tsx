'use client';
import React from 'react';
import type { A11yProps, AssetUrl, EventEmit } from '@almadar/core';
import { cn, domPassthrough, useEventBus, useTranslate } from '../../../core';

export type AnnotatedMediaType = 'image' | 'video';

export interface AnnotatedPin {
  /** Row id the pin stands for */
  id: string;
  /** Horizontal position as a percentage of the media width (0-100) */
  x?: number;
  /** Vertical position as a percentage of the media height (0-100) */
  y?: number;
  /** Playback second the pin belongs to (video) */
  time?: number;
  /** Short text shown on hover */
  label?: string;
  /** A resolved pin is drawn muted */
  resolved?: boolean;
}

export type AnnotatedPlacePayload = { x: number; y: number; time: number };
export type AnnotatedPinPayload = { id: string };

/**
 * An image or video reviewers comment on in place: numbered pins sit where each comment was left, and a click on the media asks for a new one at that spot (and, for video, at that second).
 * @capabilities review an image, comment on a design, pin feedback, markup, annotate a video at a timestamp, proofing
 * @accessibleName title
 */
export interface AnnotatedMediaProps extends A11yProps {
  /** Image or video URL */
  src: AssetUrl;
  /** What `src` is */
  mediaType?: AnnotatedMediaType;
  /** Accessible name of the media */
  title?: string;
  /** Comments to draw as numbered pins, in order */
  pins?: AnnotatedPin[];
  /** The pin to highlight */
  activePinId?: string;
  /** Whether a click on the media places a new pin */
  placing?: boolean;
  /** Event fired when the media is clicked to place a pin; the payload carries x and y as percentages and the playback second (0 for an image) */
  placeEvent?: EventEmit<AnnotatedPlacePayload>;
  /** Event fired when a pin is clicked; the payload names the pin's id */
  pinSelectEvent?: EventEmit<AnnotatedPinPayload>;
  /** Additional class names */
  className?: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number): number => Math.min(100, Math.max(0, n));

export const AnnotatedMedia: React.FC<AnnotatedMediaProps> = ({
  src,
  mediaType = 'image',
  title,
  pins = [],
  activePinId,
  placing = true,
  placeEvent,
  pinSelectEvent,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = React.useState(0);

  const place = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!placing || !placeEvent) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const video = videoRef.current;
      if (video) video.pause();
      eventBus.emit(`UI:${placeEvent}`, {
        x: round1(clamp(((event.clientX - box.left) / box.width) * 100)),
        y: round1(clamp(((event.clientY - box.top) / box.height) * 100)),
        time: video ? round1(video.currentTime) : 0,
      });
    },
    [placing, placeEvent, eventBus],
  );

  const select = React.useCallback(
    (pin: AnnotatedPin) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const video = videoRef.current;
      if (video && pin.time !== undefined) {
        video.currentTime = pin.time;
        video.pause();
      }
      if (pinSelectEvent) eventBus.emit(`UI:${pinSelectEvent}`, { id: pin.id });
    },
    [pinSelectEvent, eventBus],
  );

  const pinClass = (pin: AnnotatedPin): string =>
    cn(
      'flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background text-xs font-semibold shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      pin.resolved ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
      pin.id === activePinId && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
    );

  const placed = pins.filter((pin) => pin.x !== undefined && pin.y !== undefined);
  const timed = mediaType === 'video' ? pins.filter((pin) => pin.time !== undefined) : [];

  return (
    <div {...domPassthrough(rest)} className={cn('flex w-full flex-col gap-2', className)} data-pattern="annotated-media">
      <div
        className={cn('relative w-full overflow-hidden rounded-md bg-muted', placing && placeEvent && 'cursor-crosshair')}
        onClick={place}
        role="region"
        aria-label={title || t('aria.annotatedMedia')}
      >
        {mediaType === 'video' ? (
          <video
            ref={videoRef}
            src={src}
            controls
            className="block w-full"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onClick={(event) => event.preventDefault()}
          />
        ) : (
          <img src={src} alt={title || ''} className="block w-full select-none" draggable={false} />
        )}
        {placed.map((pin) => (
          <button
            key={pin.id}
            type="button"
            className={cn('absolute', pinClass(pin))}
            style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            onClick={select(pin)}
            title={pin.label}
            aria-label={pin.label || String(pins.indexOf(pin) + 1)}
            aria-pressed={pin.id === activePinId}
          >
            {pins.indexOf(pin) + 1}
          </button>
        ))}
      </div>
      {timed.length > 0 && duration > 0 ? (
        <div className="relative h-8 w-full rounded-md bg-muted" aria-label={t('aria.annotatedTimeline')}>
          {timed.map((pin) => (
            <button
              key={pin.id}
              type="button"
              className={cn('absolute top-1/2', pinClass(pin))}
              style={{ left: `${clamp(((pin.time ?? 0) / duration) * 100)}%` }}
              onClick={select(pin)}
              title={pin.label}
              aria-label={pin.label || String(pins.indexOf(pin) + 1)}
            >
              {pins.indexOf(pin) + 1}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

AnnotatedMedia.displayName = 'AnnotatedMedia';
