'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { A11yProps, AssetUrl } from '@almadar/core';
import { cn } from '../lib/cn';

export type GraphicAnimation = 'draw' | 'fill' | 'pulse' | 'morph';

/** @accessibleName alt */
export interface AnimatedGraphicProps extends Omit<React.HTMLAttributes<HTMLDivElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** URL to an SVG file. Fetched and inlined to enable stroke/fill animations. */
  src?: AssetUrl;
  /** Inline SVG string. Takes precedence over src if both provided. */
  svgContent?: string;
  /** Animation type applied to SVG paths/shapes */
  animation?: GraphicAnimation;
  /** Whether to run the animation (default: false). Controlled externally or via AnimatedReveal. */
  animate?: boolean;
  /** Animation duration in ms (default: 1200) */
  duration?: number;
  /** Delay before animation starts in ms (default: 0) */
  delay?: number;
  /** Easing function (default: cubic-bezier(0.16, 1, 0.3, 1)) */
  easing?: string;
  /** Width of the graphic container */
  width?: string | number;
  /** Height of the graphic container */
  height?: string | number;
  /** Stroke color override for SVG paths */
  strokeColor?: string;
  /** Fill color for the 'fill' animation end state */
  fillColor?: string;
  /** Alt text for accessibility */
  alt?: string;
}

function useFetchedSvg(src: AssetUrl | undefined): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  const cache = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!src) { setSvg(null); return; }
    if (cache.current[src]) { setSvg(cache.current[src]); return; }

    let cancelled = false;
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch SVG: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        cache.current[src] = text;
        setSvg(text);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });

    return () => { cancelled = true; };
  }, [src]);

  return svg;
}

function applyDrawAnimation(
  container: HTMLDivElement,
  animate: boolean,
  duration: number,
  delay: number,
  easing: string,
) {
  const paths = container.querySelectorAll<SVGGeometryElement>('path, line, polyline, polygon, circle, ellipse, rect');
  paths.forEach((el) => {
    if ('getTotalLength' in el && typeof el.getTotalLength === 'function') {
      const len = el.getTotalLength();
      el.style.strokeDasharray = `${len}`;
      el.style.strokeDashoffset = animate ? '0' : `${len}`;
      el.style.transition = `stroke-dashoffset ${duration}ms ${easing} ${delay}ms`;
    }
  });
}

function applyFillAnimation(
  container: HTMLDivElement,
  animate: boolean,
  duration: number,
  delay: number,
  easing: string,
  fillColor?: string,
) {
  const paths = container.querySelectorAll<SVGElement>('path, circle, ellipse, rect, polygon');
  paths.forEach((el) => {
    // Draw stroke first, then fill
    if ('getTotalLength' in el && typeof (el as SVGGeometryElement).getTotalLength === 'function') {
      const geom = el as SVGGeometryElement;
      const len = geom.getTotalLength();
      geom.style.strokeDasharray = `${len}`;
      geom.style.strokeDashoffset = animate ? '0' : `${len}`;
      geom.style.transition = `stroke-dashoffset ${duration * 0.6}ms ${easing} ${delay}ms, fill-opacity ${duration * 0.4}ms ${easing} ${delay + duration * 0.6}ms`;
    }
    if (fillColor) el.style.fill = fillColor;
    el.style.fillOpacity = animate ? '1' : '0';
  });
}

function applyPulseAnimation(
  container: HTMLDivElement,
  animate: boolean,
  duration: number,
) {
  const svg = container.querySelector('svg');
  if (!svg) return;
  if (animate) {
    svg.style.animation = `ag-pulse ${duration}ms ease-in-out infinite`;
  } else {
    svg.style.animation = 'none';
  }
}

function applyMorphAnimation(
  container: HTMLDivElement,
  animate: boolean,
  duration: number,
  delay: number,
  easing: string,
) {
  const paths = container.querySelectorAll<SVGElement>('path, circle, ellipse, rect, polygon');
  paths.forEach((el) => {
    el.style.transition = `all ${duration}ms ${easing} ${delay}ms`;
    el.style.transform = animate ? 'scale(1)' : 'scale(0)';
    el.style.transformOrigin = 'center';
    el.style.opacity = animate ? '1' : '0';
  });
}

export const AnimatedGraphic = React.forwardRef<HTMLDivElement, AnimatedGraphicProps>(
  (
    {
      src,
      svgContent,
      animation = 'draw',
      animate = false,
      duration = 1200,
      delay = 0,
      easing = 'cubic-bezier(0.16, 1, 0.3, 1)',
      width,
      height,
      strokeColor,
      fillColor,
      alt,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const fetchedSvg = useFetchedSvg(svgContent ? undefined : src);
    const resolvedSvg = svgContent ?? fetchedSvg;
    const prevAnimateRef = useRef(animate);

    // Merge refs
    const setRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref],
    );

    // Apply stroke color override after SVG is injected
    useEffect(() => {
      const el = containerRef.current;
      if (!el || !strokeColor) return;
      const paths = el.querySelectorAll<SVGElement>('path, line, polyline, polygon, circle, ellipse, rect');
      paths.forEach((p) => { p.style.stroke = strokeColor; });
    }, [resolvedSvg, strokeColor]);

    // Initialize draw state (hidden) when SVG first loads
    useEffect(() => {
      const el = containerRef.current;
      if (!el || !resolvedSvg) return;
      if (animation === 'draw' || animation === 'fill') {
        const paths = el.querySelectorAll<SVGGeometryElement>('path, line, polyline, polygon, circle, ellipse, rect');
        paths.forEach((p) => {
          if ('getTotalLength' in p && typeof p.getTotalLength === 'function') {
            const len = p.getTotalLength();
            p.style.strokeDasharray = `${len}`;
            p.style.strokeDashoffset = `${len}`;
          }
          if (animation === 'fill') {
            p.style.fillOpacity = '0';
          }
        });
      }
      if (animation === 'morph') {
        const paths = el.querySelectorAll<SVGElement>('path, circle, ellipse, rect, polygon');
        paths.forEach((p) => {
          p.style.transform = 'scale(0)';
          p.style.transformOrigin = 'center';
          p.style.opacity = '0';
        });
      }
    }, [resolvedSvg, animation]);

    // Apply animation when animate changes
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      // Small raf delay to let initial state paint before transitioning
      const id = requestAnimationFrame(() => {
        switch (animation) {
          case 'draw':
            applyDrawAnimation(el, animate, duration, delay, easing);
            break;
          case 'fill':
            applyFillAnimation(el, animate, duration, delay, easing, fillColor);
            break;
          case 'pulse':
            applyPulseAnimation(el, animate, duration);
            break;
          case 'morph':
            applyMorphAnimation(el, animate, duration, delay, easing);
            break;
        }
      });

      prevAnimateRef.current = animate;
      return () => cancelAnimationFrame(id);
    }, [animate, animation, duration, delay, easing, fillColor, resolvedSvg]);

    return (
      <>
        <style>{`@keyframes ag-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.04); opacity: 0.85; } }`}</style>
        <div
          ref={setRef}
          className={cn('inline-flex items-center justify-center', className)}
          style={{ width, height, ...style }}
          role={alt ? 'img' : undefined}
          aria-label={alt}
          {...props}
        >
          {resolvedSvg ? (
            <div
              className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: resolvedSvg }}
            />
          ) : children}
        </div>
      </>
    );
  },
);

AnimatedGraphic.displayName = 'AnimatedGraphic';
