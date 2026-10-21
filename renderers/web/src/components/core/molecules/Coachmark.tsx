'use client';
/**
 * Coachmark Molecule
 *
 * A controlled, externally-anchored popover for onboarding hints. Unlike
 * Popover (uncontrolled, wraps its own trigger), a Coachmark is driven by
 * `open` and points at an element it does not own — a tab button, the persona
 * menu, a canvas node — resolved from a ref, a CSS selector, or a DOMRect.
 * Portals into the shared portal root so it escapes the canvas/preview transform contexts.
 */
import type { A11yProps } from "@almadar/core";
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import { ThemedPortal } from "../../../lib/ThemedPortal";
import { domPassthrough } from '../../../core';

export type CoachmarkPlacement = "top" | "bottom" | "left" | "right";
export type CoachmarkAnchor =
  | React.RefObject<HTMLElement | null>
  | string
  | DOMRect;

export interface CoachmarkProps extends A11yProps {
  /** Controlled visibility. */
  open: boolean;
  /** The element to point at: a ref, a CSS selector, or a DOMRect. */
  anchor: CoachmarkAnchor;
  /** Side of the anchor to render on. @default 'bottom' */
  placement?: CoachmarkPlacement;
  title?: string;
  children: React.ReactNode;
  /** Close (X) handler — always rendered. */
  onDismiss: () => void;
  /** Optional filled primary action (e.g. Next / Got it). */
  onPrimary?: () => void;
  primaryLabel?: string;
  /** Optional ghost secondary action (e.g. Skip). */
  onSecondary?: () => void;
  secondaryLabel?: string;
  /** Render a pulsing beacon dot over the anchor (keystone hints). */
  showBeacon?: boolean;
  /**
   * If the anchor can't be resolved, render the card centered in the viewport
   * instead of hiding it. Guarantees the card (and its dismiss/skip) is always
   * reachable — used by OnboardingSpotlight so a missing anchor never traps the
   * user behind a dimmed backdrop. Default false: a missing anchor hides the card.
   */
  fallbackCentered?: boolean;
  className?: string;
}

const GAP = 10;
const EDGE = 8;

function resolveAnchorRect(anchor: CoachmarkAnchor): DOMRect | null {
  if (typeof anchor === "string") {
    return document.querySelector(anchor)?.getBoundingClientRect() ?? null;
  }
  if (anchor instanceof DOMRect) return anchor;
  return anchor?.current?.getBoundingClientRect() ?? null;
}

/**
 * Tracks the live bounding rect of an anchor while `active`. Re-reads on
 * scroll/resize, and polls a few frames so a selector that mounts just after
 * activation (a freshly-revealed tab) still resolves.
 */
export function useAnchorRect(
  anchor: CoachmarkAnchor,
  active: boolean,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const read = useCallback(() => resolveAnchorRect(anchor), [anchor]);

  useEffect(() => {
    if (!active || typeof document === "undefined") {
      setRect(null);
      return;
    }
    const update = (): void => setRect(read());
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    let raf = 0;
    let tries = 0;
    const poll = (): void => {
      const found = read();
      if (found) {
        setRect(found);
      } else if (tries++ < 40) {
        raf = requestAnimationFrame(poll);
      }
    };
    if (!read()) raf = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, read]);

  return rect;
}

function placeCard(
  placement: CoachmarkPlacement,
  rect: DOMRect,
  size: { w: number; h: number },
): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  let top = 0;
  let left = 0;
  switch (placement) {
    case "top":
      top = rect.top - size.h - GAP;
      left = rect.left + rect.width / 2 - size.w / 2;
      break;
    case "left":
      left = rect.left - size.w - GAP;
      top = rect.top + rect.height / 2 - size.h / 2;
      break;
    case "right":
      left = rect.right + GAP;
      top = rect.top + rect.height / 2 - size.h / 2;
      break;
    case "bottom":
    default:
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - size.w / 2;
      break;
  }
  left = Math.max(EDGE, Math.min(left, vw - size.w - EDGE));
  top = Math.max(EDGE, Math.min(top, vh - size.h - EDGE));
  return { top, left };
}

export const Coachmark: React.FC<CoachmarkProps> = ({
  open,
  anchor,
  placement = "bottom",
  title,
  children,
  onDismiss,
  onPrimary,
  primaryLabel,
  onSecondary,
  secondaryLabel,
  showBeacon = false,
  fallbackCentered = false,
  className,
  ...rest
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslate();
  const rect = useAnchorRect(anchor, open);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const centered = open && !rect && fallbackCentered;

  useLayoutEffect(() => {
    if (!open || !rect || !cardRef.current) {
      setPos(null);
      return;
    }
    const size = {
      w: cardRef.current.offsetWidth,
      h: cardRef.current.offsetHeight,
    };
    setPos(placeCard(placement, rect, size));
  }, [open, rect, placement, children, title]);

  // Escape always dismisses — a coach-mark must never trap focus or the screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open || typeof document === "undefined") return null;
  // No anchor and no centered fallback → render nothing (don't trap behind any
  // backdrop a parent may have drawn).
  if (!rect && !centered) return null;

  const hasFooter = Boolean(onPrimary || onSecondary);

  const cardStyle: React.CSSProperties = centered
    ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
    : pos
      ? { top: pos.top, left: pos.left }
      : { top: -9999, left: -9999 };

  const card = (
    <Box
      ref={cardRef}
      bg="surface"
      border
      rounded="lg"
      padding="md"
      {...domPassthrough(rest)}
      role="dialog"
      aria-label={rest["aria-label"] ?? title}
      className={cn("shadow-elevation-popover", 
        "fixed z-50 max-w-xs w-72 transition-opacity duration-fast",
        centered || pos ? "opacity-100" : "opacity-0",
        className,
      )}
      style={cardStyle}
    >
      <Button
        variant="ghost"
        size="sm"
        icon="close"
        aria-label={t('aria.dismiss')}
        onClick={onDismiss}
        className="absolute top-1 right-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      />

      {title && (
        <Typography variant="body1" weight="semibold" className="pr-6 mb-1">
          {title}
        </Typography>
      )}

      <Typography variant="body2" color="muted" as="div">
        {children}
      </Typography>

      {hasFooter && (
        <div className="mt-3 flex items-center justify-end gap-2">
          {onSecondary && (
            <Button variant="ghost" size="sm" onClick={onSecondary}>
              {secondaryLabel ?? t('coachmark.skip')}
            </Button>
          )}
          {onPrimary && (
            <Button variant="primary" size="sm" onClick={onPrimary}>
              {primaryLabel ?? t('coachmark.gotIt')}
            </Button>
          )}
        </div>
      )}
    </Box>
  );

  const beacon = showBeacon && rect ? (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        top: rect.top + rect.height / 2 - 6,
        left: rect.left + rect.width / 2 - 6,
      }}
      aria-hidden="true"
    >
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-primary)] opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--color-primary)]" />
      </span>
    </div>
  ) : null;

  return (<ThemedPortal>{
    <>
      {beacon}
      {card}
    </>}</ThemedPortal>);
};

Coachmark.displayName = "Coachmark";