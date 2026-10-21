'use client';

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { EventEmit, EventPayload, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Box, Typography, Button } from '../../../core';
import { Icon } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
/**
 * QR scan callback payload. Extends `EventPayload` (string-indexed
 * `EventPayloadValue` map) so the result is directly assignable to a
 * render-ui dispatched event payload without re-shaping.
 */
export type QrScanResult = EventPayload & {
  text: string;
  format: string;
  timestamp: number;
};

export interface QrScannerProps extends A11yProps {
  onScan?: (result: QrScanResult) => void;
  scanEvent?: EventEmit<QrScanResult>;
  /** @notification */
  onError?: (error: Error) => void;
  facingMode?: 'environment' | 'user';
  paused?: boolean;
  showOverlay?: boolean;
  showCameraControls?: boolean;
  fallback?: React.ReactNode;
  className?: string;
}

export const QrScanner: React.FC<QrScannerProps> = ({
  onScan,
  scanEvent,
  onError,
  facingMode = 'environment',
  paused = false,
  showOverlay = true,
  showCameraControls = true,
  fallback,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const tRef = useRef(t);
  tRef.current = t;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentFacing, setCurrentFacing] = useState<'environment' | 'user'>(facingMode);
  const [isPaused, setIsPaused] = useState(paused);
  const [cameraError, setCameraError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsReady(false);
  }, []);

  const startStream = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const err = new Error(tRef.current('qrScanner.apiUnavailable'));
      setCameraError(err);
      onError?.(err);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraError(null);
      setIsReady(true);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setCameraError(err);
      onError?.(err);
      setIsReady(false);
    }
  }, [currentFacing, onError]);

  useEffect(() => {
    if (isPaused) {
      stopStream();
      return;
    }
    void startStream();
    return () => {
      stopStream();
    };
  }, [currentFacing, isPaused, startStream, stopStream]);

  useEffect(() => {
    setIsPaused(paused);
  }, [paused]);

  useEffect(() => {
    setCurrentFacing(facingMode);
  }, [facingMode]);

  useEffect(() => {
    if (!isReady || isPaused) return;
    scanIntervalRef.current = setInterval(() => {
      // TODO(qr-decode): wire jsQR or zxing-wasm — outside Phase 10 scope
    }, 200);
    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [isReady, isPaused]);

  const toggleFacing = useCallback(() => {
    setCurrentFacing((f) => (f === 'environment' ? 'user' : 'environment'));
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  const videoExtraProps: React.VideoHTMLAttributes<HTMLVideoElement> = {
    playsInline: true,
    muted: true,
  };

  if (cameraError && fallback) {
    return <Box {...domPassthrough(rest)} position="relative" className={className}>{fallback}</Box>;
  }

  return (
    <Box
      {...domPassthrough(rest)}
      position="relative"
      overflow="hidden"
      rounded="sm"
      className={cn(
        // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
        "bg-black",
        "aspect-square w-full max-w-md",
        className,
      )}
      data-pattern="qr-scanner"
      role="region"
      aria-label={rest['aria-label'] ?? t('aria.qrScanner')}
    >
      <Box
        as="video"
        ref={videoRef as React.Ref<HTMLDivElement>}
        position="absolute"
        fullWidth
        fullHeight
        className="inset-0 object-cover"
        aria-hidden="true"
        {...(videoExtraProps as Omit<React.HTMLAttributes<HTMLDivElement>, keyof A11yProps>)}
      />

      {showOverlay && isReady && !isPaused && (
        <Box position="absolute" className="pointer-events-none inset-0">
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Box position="absolute" className="left-[15%] top-[15%] h-8 w-8 border-l-heavy border-t-heavy border-white" />
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Box position="absolute" className="right-[15%] top-[15%] h-8 w-8 border-r-heavy border-t-heavy border-white" />
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Box position="absolute" className="bottom-[15%] left-[15%] h-8 w-8 border-b-heavy border-l-heavy border-white" />
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Box position="absolute" className="bottom-[15%] right-[15%] h-8 w-8 border-b-heavy border-r-heavy border-white" />
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Box position="absolute" className="left-[15%] right-[15%] top-1/2 h-px bg-white opacity-60" />
        </Box>
      )}

      {cameraError && !fallback && (
        <Box
          position="absolute"
          display="flex"
          padding="lg"
          // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
          className="inset-0 flex-col items-center justify-center gap-2 bg-black bg-opacity-80 text-center"
        >
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Icon name="camera" className="h-8 w-8 text-white" aria-hidden="true" />
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Typography variant="body2" className="text-white">{t('qrScanner.cameraUnavailable')}</Typography>
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Typography variant="caption" className="text-white opacity-70">{cameraError.message}</Typography>
        </Box>
      )}

      {isPaused && !cameraError && (
        <Box
          position="absolute"
          display="flex"
          // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
          className="inset-0 items-center justify-center bg-black bg-opacity-60"
        >
          {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim */}
          <Typography variant="body2" className="text-white">{t('qrScanner.paused')}</Typography>
        </Box>
      )}

      {showCameraControls && (
        <Box
          position="absolute"
          display="flex"
          className="bottom-3 left-1/2 -translate-x-1/2 gap-2"
        >
          <Button
            type="button"
            onClick={togglePause}
            className={cn(
              // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
              "rounded-full bg-black bg-opacity-60 p-2 text-white",
              // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
              "hover:bg-opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
            )}
            aria-label={isPaused ? t('qrScanner.resumeScanning') : t('qrScanner.pauseScanning')}
          >
            {isPaused ? <Icon name="play" className="h-4 w-4" /> : <Icon name="pause" className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            onClick={toggleFacing}
            className={cn(
              // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
              "rounded-full bg-black bg-opacity-60 p-2 text-white",
              // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
              "hover:bg-opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
            )}
            aria-label={currentFacing === 'environment' ? t('qrScanner.switchToFrontCamera') : t('qrScanner.switchToRearCamera')}
          >
            <Icon name="refresh-cw" className="h-4 w-4" />
          </Button>
        </Box>
      )}
    </Box>
  );
};

QrScanner.displayName = "QrScanner";