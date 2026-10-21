'use client';
import * as React from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { domPassthrough } from "../lib/domPassthrough";
import { useEventBus } from "../hooks/useEventBus";
import { useTranslate } from "../hooks/useTranslate";

export type VideoReadyPayload = { source: string };
export type VideoErrorPayload = { error: string; code: string };
export type VideoPlayPayload = { source: string };

/**
 * Embedded video player: a YouTube video by id, or any player page by URL. Fires a ready event once it can play and an error event when it cannot.
 * @capabilities embedded video, YouTube player, lesson video, video embed, play a video by id or URL, player ready and error events
 * @accessibleName title
 */
export interface VideoEmbedProps extends A11yProps {
  /** YouTube video id (the 11 characters of the share URL); played through the YouTube IFrame API */
  videoId?: string;
  /** URL of any other embeddable player page; used when no `videoId` is set */
  src?: string;
  /** Accessible name of the player */
  title?: string;
  /** Start playback as soon as the player is ready (YouTube ids only) */
  autoplay?: boolean;
  /** Show the player's own controls (YouTube ids only) */
  controls?: boolean;
  /** Second of the video to start from (YouTube ids only) */
  start?: number;
  /** Event fired once the player is ready to play; the payload names the video id or URL */
  readyEvent?: EventEmit<VideoReadyPayload>;
  /** Event fired each time the YouTube player begins or resumes playing; the payload names the video id */
  playEvent?: EventEmit<VideoPlayPayload>;
  /** Event fired when the YouTube player cannot load or play the video; the payload carries the message and the player's error code. A plain URL never fires it: a browser reports no load failure for a page frame */
  errorEvent?: EventEmit<VideoErrorPayload>;
  /** Additional class names */
  className?: string;
}

interface YouTubePlayer {
  destroy(): void;
}

interface YouTubePlayerOptions {
  videoId: string;
  playerVars: { autoplay: 0 | 1; controls: 0 | 1; start: number; rel: 0 };
  events: { onReady: () => void; onError: (event: { data: number }) => void; onStateChange: (event: { data: number }) => void };
}

interface YouTubeApi {
  Player: new (host: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";

let youTubeApi: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youTubeApi) return youTubeApi;
  youTubeApi = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YT missing after load"));
    };
    const script = document.createElement("script");
    script.src = YOUTUBE_API_SRC;
    script.async = true;
    script.onerror = () => {
      youTubeApi = null;
      reject(new Error("script failed"));
    };
    document.head.appendChild(script);
  });
  return youTubeApi;
}

const YOUTUBE_PLAYING = 1;

const ERROR_KEYS: Readonly<Record<number, string>> = {
  2: "videoEmbed.invalidVideo",
  5: "videoEmbed.playbackFailed",
  100: "videoEmbed.notFound",
  101: "videoEmbed.notEmbeddable",
  150: "videoEmbed.notEmbeddable",
};

export const VideoEmbed: React.FC<VideoEmbedProps> = ({
  videoId,
  src,
  title,
  autoplay = false,
  controls = true,
  start = 0,
  readyEvent,
  playEvent,
  errorEvent,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const hostRef = React.useRef<HTMLDivElement>(null);
  const announce = React.useRef({ readyEvent, playEvent, errorEvent, eventBus, t });
  announce.current = { readyEvent, playEvent, errorEvent, eventBus, t };

  const fireReady = React.useCallback((source: string) => {
    const { readyEvent: ready, eventBus: bus } = announce.current;
    if (ready) bus.emit(`UI:${ready}`, { source });
  }, []);

  const firePlay = React.useCallback((source: string) => {
    const { playEvent: play, eventBus: bus } = announce.current;
    if (play) bus.emit(`UI:${play}`, { source });
  }, []);

  const fireError = React.useCallback((key: string, code: string) => {
    const { errorEvent: failed, eventBus: bus, t: translate } = announce.current;
    if (failed) bus.emit(`UI:${failed}`, { error: translate(key), code });
  }, []);

  React.useEffect(() => {
    const wrapper = hostRef.current;
    if (!videoId || !wrapper) return;
    const mount = document.createElement("div");
    wrapper.appendChild(mount);
    let player: YouTubePlayer | null = null;
    let cancelled = false;
    loadYouTubeApi().then(
      (api) => {
        if (cancelled) return;
        player = new api.Player(mount, {
          videoId,
          playerVars: { autoplay: autoplay ? 1 : 0, controls: controls ? 1 : 0, start, rel: 0 },
          events: {
            onReady: () => fireReady(videoId),
            onStateChange: (event) => {
              if (event.data === YOUTUBE_PLAYING) firePlay(videoId);
            },
            onError: (event) => fireError(ERROR_KEYS[event.data] ?? "videoEmbed.playbackFailed", String(event.data)),
          },
        });
      },
      () => {
        if (!cancelled) fireError("videoEmbed.apiUnavailable", "api_unavailable");
      },
    );
    return () => {
      cancelled = true;
      player?.destroy();
      mount.remove();
    };
  }, [videoId, autoplay, controls, start, fireReady, firePlay, fireError]);

  const frame = cn("aspect-video w-full overflow-hidden rounded-md bg-muted [&>iframe]:h-full [&>iframe]:w-full", className);

  if (videoId) {
    return (
      <div
        {...domPassthrough(rest)}
        ref={hostRef}
        className={frame}
        role="region"
        aria-label={title ?? t("aria.videoEmbed")}
        data-pattern="video-embed"
      />
    );
  }

  return (
    <div {...domPassthrough(rest)} className={cn(frame, !src && "flex items-center justify-center text-sm text-muted-foreground")} data-pattern="video-embed">
      {src ? (
        <iframe
          src={src}
          title={title ?? t("aria.videoEmbed")}
          className="border-0"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          onLoad={() => fireReady(src)}
        />
      ) : (
        <span>{t("videoEmbed.noVideo")}</span>
      )}
    </div>
  );
};

VideoEmbed.displayName = "VideoEmbed";
