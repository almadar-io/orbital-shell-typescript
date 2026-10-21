'use client';
/**
 * LawReferenceTooltip Atom Component
 *
 * A specialized tooltip for displaying law references in inspection forms.
 * Shows law name, article number, and relevant clause text.
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from "react";
import { Box } from "./Box";
import { VStack } from "./Stack";
import { Typography } from "./Typography";
import { Divider } from "./Divider";
import { cn } from "../lib/cn";
import { useTranslate } from "../hooks/useTranslate";
import { useTapReveal } from "../hooks/useTapReveal";

/**
 * Law reference definition
 */
export type LawReference = {
  /** Law identifier (e.g., "VVO", "TPED") */
  law: string;
  /** Full name of the law */
  lawName?: string;
  /** Article number (e.g., "§8", "Artikel 5") */
  article: string;
  /** Clause or paragraph text */
  clause?: string;
  /** Optional link to full law text */
  link?: string;
};

export interface LawReferenceTooltipProps extends A11yProps {
  /** The law reference to display */
  reference: LawReference;
  /** Children element that triggers the tooltip */
  children: React.ReactNode;
  /** Tooltip position */
  position?: "top" | "bottom" | "left" | "right";
  /** Additional CSS classes */
  className?: string;
}

/**
 * Position styles for tooltip placement
 */
const positionStyles = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * Arrow styles based on position
 */
const arrowStyles = {
  top: "top-full left-1/2 -translate-x-1/2 border-t-foreground border-l-transparent border-r-transparent border-b-transparent",
  bottom:
    "bottom-full left-1/2 -translate-x-1/2 border-b-foreground border-l-transparent border-r-transparent border-t-transparent",
  left: "left-full top-1/2 -translate-y-1/2 border-l-foreground border-t-transparent border-b-transparent border-r-transparent",
  right:
    "right-full top-1/2 -translate-y-1/2 border-r-foreground border-t-transparent border-b-transparent border-l-transparent",
};

/**
 * LawReferenceTooltip displays legal references with structured formatting.
 *
 * @example
 * <LawReferenceTooltip
 *   reference={{
 *     law: "VVO",
 *     lawName: "Verkehrsverordnung",
 *     article: "§8 Abs. 3",
 *     clause: "Die zulässige Gesamtmasse darf 3500 kg nicht überschreiten."
 *   }}
 * >
 *   <Typography variant="small" className="text-blue-600 underline cursor-help">VVO §8</Typography>
 * </LawReferenceTooltip>
 */
export const LawReferenceTooltip: React.FC<LawReferenceTooltipProps> = ({
  reference,
  children,
  position = "top",
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const [isVisible, setIsVisible] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsVisible(true), 200);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  // Touch/pen has no hover: a tap reveals the same tooltip; a tap outside dismisses it.
  const { revealed, triggerProps } = useTapReveal({ refs: [triggerRef] });
  const open = isVisible || revealed;

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <Box
      ref={triggerRef}
      as="span"
      position="relative"
      display="inline-block"
      className={className}
      {...domPassthrough(rest)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      onPointerDown={triggerProps.onPointerDown}
    >
      {children}
      {open && (
        <Box
          padding="sm"
          rounded="lg"
          position="absolute"
          className={cn(
            "z-50 w-64 bg-foreground text-background shadow-elevation-popover",
            positionStyles[position],
          )}
          role="tooltip"
        >
          <VStack gap="xs">
            {/* Law header */}
            <Typography
              variant="label"
              weight="semibold"
              className="text-warning"
            >
              {reference.law} {reference.article}
            </Typography>

            {/* Law name */}
            {reference.lawName && (
              <Typography
                variant="caption"
                className="text-muted-foreground"
              >
                {reference.lawName}
              </Typography>
            )}

            {/* Clause text */}
            {reference.clause && (
              <>
                <Divider className="border-border" />
                <Typography
                  variant="caption"
                  className="text-background leading-relaxed"
                >
                  {reference.clause}
                </Typography>
              </>
            )}

            {/* Link to full text */}
            {reference.link && (
              <a
                href={reference.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                className="text-xs text-info hover:text-info/80 underline cursor-pointer"
              >
                {t('lawReference.viewFullText')}
              </a>
            )}
          </VStack>

          {/* Arrow */}
          <Box
            as="span"
            position="absolute"
            className={cn("w-0 h-0 border-heavy", arrowStyles[position])}
          />
        </Box>
      )}
    </Box>
  );
};

LawReferenceTooltip.displayName = "LawReferenceTooltip";
