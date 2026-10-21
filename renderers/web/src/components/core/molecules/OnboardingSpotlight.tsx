'use client';
/**
 * OnboardingSpotlight Molecule
 *
 * Optional first-run welcome: a dimmed backdrop with a cut-out over the current
 * step's anchor, plus a stepped Coachmark bubble (Next / Skip). The backdrop is
 * four dim rectangles around the anchor rect so the highlighted element stays
 * lit and clickable-looking; the bubble and step dots reuse Coachmark.
 */
import React from "react";
import { Coachmark, useAnchorRect, type CoachmarkAnchor, type CoachmarkPlacement } from "./Coachmark";
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import { ThemedPortal } from "../../../lib/ThemedPortal";

export interface SpotlightStep {
  anchor: CoachmarkAnchor;
  placement?: CoachmarkPlacement;
  title: string;
  body: string;
}

export interface OnboardingSpotlightProps {
  steps: SpotlightStep[];
  /** Index of the active step. Out-of-range hides the spotlight. */
  stepIndex: number;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
  /** Padding around the cut-out, in px. @default 6 */
  cutoutPadding?: number;
}

const DIM = "fixed z-[45] bg-scrim";

export const OnboardingSpotlight: React.FC<OnboardingSpotlightProps> = ({
  steps,
  stepIndex,
  onNext,
  onSkip,
  onFinish,
  cutoutPadding = 6,
}) => {
  const { t } = useTranslate();
  const step = steps[stepIndex];
  const rect = useAnchorRect(step?.anchor ?? "", Boolean(step));

  if (!step || typeof document === "undefined") return null;

  const isLast = stepIndex >= steps.length - 1;

  // Four dim rectangles forming a hole around the anchor. Until the rect is
  // known, dim the whole viewport (single rect) so there's no unlit flash.
  const backdrop = rect ? (
    (() => {
      const p = cutoutPadding;
      const top = Math.max(0, rect.top - p);
      const left = Math.max(0, rect.left - p);
      const right = rect.right + p;
      const bottom = rect.bottom + p;
      return (
        <>
          <div className={DIM} style={{ top: 0, left: 0, right: 0, height: top }} />
          <div className={DIM} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
          <div className={DIM} style={{ top, left: 0, width: left, height: bottom - top }} />
          <div className={DIM} style={{ top, left: right, right: 0, height: bottom - top }} />
        </>
      );
    })()
  ) : (
    <div className={cn(DIM, "inset-0")} />
  );

  return (
    <>
      {(<ThemedPortal>{backdrop}</ThemedPortal>)}
      <Coachmark
        open
        anchor={step.anchor}
        placement={step.placement ?? "bottom"}
        fallbackCentered
        title={step.title}
        onDismiss={onSkip}
        onSecondary={onSkip}
        secondaryLabel={t('coachmark.skip')}
        onPrimary={isLast ? onFinish : onNext}
        primaryLabel={isLast ? t('common.done') : t('nav.next')}
      >
        <span>{step.body}</span>
        <span className="mt-3 flex items-center gap-1.5">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                i === stepIndex
                  ? "bg-[var(--color-primary)]"
                  : "bg-[var(--color-border)]",
              )}
            />
          ))}
        </span>
      </Coachmark>
    </>
  );
};

OnboardingSpotlight.displayName = "OnboardingSpotlight";
