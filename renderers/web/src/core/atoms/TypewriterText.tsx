'use client';
/**
 * TypewriterText Atom Component
 *
 * Reveals text character-by-character with a blinking cursor
 * that disappears after the full text has been typed out.
 */
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React, { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Typography } from "./Typography";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

export interface TypewriterTextProps extends A11yProps {
  /** The full text to reveal */
  text: string;
  /** Milliseconds per character */
  speed?: number;
  /** Delay before typing starts (ms) */
  startDelay?: number;
  /** Additional class names */
  className?: string;
  /**
   * Called when the entire text has been revealed
   * @notification
   */
  onComplete?: () => void;
}

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  speed = 40,
  startDelay = 0,
  className,
  onComplete,
  ...rest
}) => {
  const safeText = typeof text === 'string' ? text : String(text ?? '');
  const [charCount, setCharCount] = useState(0);
  const [started, setStarted] = useState(startDelay === 0);
  const reducedMotion = usePrefersReducedMotion();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Handle start delay
  useEffect(() => {
    if (startDelay <= 0) {
      setStarted(true);
      return undefined;
    }

    setStarted(false);
    setCharCount(0);

    const delayTimer = window.setTimeout(() => {
      setStarted(true);
    }, startDelay);

    return () => {
      window.clearTimeout(delayTimer);
    };
  }, [startDelay, text]);

  // Reset when text changes
  useEffect(() => {
    setCharCount(0);
  }, [text]);

  // Character-by-character reveal
  useEffect(() => {
    if (!started) return undefined;

    if (reducedMotion || charCount >= safeText.length) {
      onCompleteRef.current?.();
      return undefined;
    }

    const interval = window.setInterval(() => {
      setCharCount((prev) => {
        const next = prev + 1;
        if (next >= safeText.length) {
          window.clearInterval(interval);
        }
        return next;
      });
    }, speed);

    return () => {
      window.clearInterval(interval);
    };
  }, [started, text, speed, charCount, reducedMotion]);

  const isComplete = reducedMotion || charCount >= safeText.length;
  const displayedText = reducedMotion ? safeText : safeText.slice(0, charCount);

  return (
    <Typography variant="body" className={cn("inline", className)} {...domPassthrough(rest)}>
      {displayedText}
      {!isComplete && (
        <span
          className="inline-block w-[2px] h-[1em] bg-foreground ml-[1px] align-text-bottom animate-pulse"
          aria-hidden="true"
        />
      )}
    </Typography>
  );
};

TypewriterText.displayName = "TypewriterText";
