'use client';

/**
 * AvlBehaviorGlyph - Visual identity for a behavior.
 *
 * Generates a unique glyph from behavior properties:
 * - Core shape = persistence type
 * - Spokes = field count
 * - Rings = state count
 * - Markers = effect types used
 * - Color = domain hue
 * - Composition = child glyphs + event wiring (molecule/organism)
 */

import React, { useMemo } from 'react';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';
import { avlSeries, effectCategoryOf } from '../../../lib/avl-theme';
import { type EntityPersistence } from '@almadar/core';
import { type EffectCategory, EFFECT_CATEGORY_COLORS } from '../../../lib/avl-theme';

// ─── Domain Colors ────────────────────────────────────────────
const DOMAIN_ORDER = [
  'commerce', 'healthcare', 'education', 'finance', 'scheduling', 'workflow',
  'social', 'media', 'gaming', 'iot', 'crm', 'analytics',
  'communication', 'content', 'location', 'hr', 'legal', 'real-estate',
] as const;

export const DOMAIN_COLORS: Record<string, string> = Object.fromEntries(DOMAIN_ORDER.map((domain, i) => [domain, avlSeries(i)]));

// ─── Types ────────────────────────────────────────────────────

export type BehaviorLevel = 'atom' | 'molecule' | 'organism';
export type GlyphSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface BehaviorGlyphChild {
  name: string;
  fieldCount?: number;
  stateCount?: number;
  persistence?: EntityPersistence;
  effectTypes?: string[];
}

export interface BehaviorGlyphConnection {
  from: string;
  to: string;
  event: string;
}

export interface AvlBehaviorGlyphProps {
  /** Behavior name */
  name: string;
  /** Composition level */
  level?: BehaviorLevel;
  /** Domain for color coding */
  domain?: string;
  /** Override color (otherwise derived from domain) */
  color?: string;
  /** Entity field count (drives spoke count) */
  fieldCount?: number;
  /** State count (drives ring count) */
  stateCount?: number;
  /** Persistence type (drives core shape) */
  persistence?: EntityPersistence;
  /** Effect types used (drives markers on rings) */
  effectTypes?: string[];
  /** Child behaviors for molecule/organism composition */
  children?: BehaviorGlyphChild[];
  /** Event connections between children (organism level) */
  connections?: BehaviorGlyphConnection[];
  /** Size preset */
  size?: GlyphSize;
  /** Show text labels */
  showLabels?: boolean;
  /** Animate orbital rings */
  animated?: boolean;
  /** Additional className */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

const SIZE_MAP: Record<GlyphSize, number> = {
  xs: 32,
  sm: 48,
  md: 120,
  lg: 200,
  xl: 300,
};

// ─── Persistence Core Shapes ──────────────────────────────────

function PersistenceCore({ cx, cy, r, persistence, color }: {
  cx: number; cy: number; r: number; persistence: EntityPersistence; color: string;
}) {
  switch (persistence) {
    case 'runtime':
      return (
        <>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="4 2" opacity={0.9} />
          <circle cx={cx} cy={cy} r={r * 0.4} fill={color} opacity={0.3}>
            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="2s" repeatCount="indefinite" />
          </circle>
        </>
      );
    case 'persistent':
    default:
      return (
        <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
      );
  }
}

// ─── Field Spokes ─────────────────────────────────────────────

function FieldSpokes({ cx, cy, innerR, outerR, count, color }: {
  cx: number; cy: number; innerR: number; outerR: number; count: number; color: string;
}) {
  if (count === 0) return null;
  const spokes = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    return (
      <line
        key={i}
        x1={cx + innerR * Math.cos(angle)}
        y1={cy + innerR * Math.sin(angle)}
        x2={cx + outerR * Math.cos(angle)}
        y2={cy + outerR * Math.sin(angle)}
        stroke={color}
        strokeWidth={1}
        opacity={0.5}
      />
    );
  });
  return <>{spokes}</>;
}

// ─── State Rings ──────────────────────────────────────────────

function StateRings({ cx, cy, baseR, count, color, animated }: {
  cx: number; cy: number; baseR: number; count: number; color: string; animated: boolean;
}) {
  if (count === 0) return null;
  const ringCount = Math.min(count, 5);
  const ringSpacing = baseR * 0.25;
  const rings = Array.from({ length: ringCount }, (_, i) => {
    const r = baseR + (i + 1) * ringSpacing;
    const opacity = 0.6 - i * 0.1;
    const width = i === 0 ? 1.5 : 1;
    return (
      <circle
        key={i}
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={width}
        opacity={opacity}
      >
        {animated && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${cx} ${cy}`}
            to={`${i % 2 === 0 ? 360 : -360} ${cx} ${cy}`}
            dur={`${8 + i * 4}s`}
            repeatCount="indefinite"
          />
        )}
      </circle>
    );
  });
  return <>{rings}</>;
}

// ─── Effect Markers ───────────────────────────────────────────

function EffectMarkers({ cx, cy, r, effectTypes, baseColor }: {
  cx: number; cy: number; r: number; effectTypes: string[]; baseColor: string;
}) {
  if (effectTypes.length === 0) return null;

  // Deduplicate by category
  const seen = new Set<EffectCategory>();
  const categories: { type: string; category: EffectCategory }[] = [];
  for (const t of effectTypes) {
    const cat = effectCategoryOf(t);
    if (cat !== null && !seen.has(cat)) {
      seen.add(cat);
      categories.push({ type: t, category: cat });
    }
  }

  return (
    <>
      {categories.map(({ type, category }, i) => {
        const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
        const mx = cx + r * Math.cos(angle);
        const my = cy + r * Math.sin(angle);
        const markerColor = EFFECT_CATEGORY_COLORS[category].color;
        const s = r * 0.12;

        return (
          <g key={type}>
            <circle cx={mx} cy={my} r={s + 1} fill={markerColor} fillOpacity={0.2} />
            <circle cx={mx} cy={my} r={s * 0.6} fill={markerColor} />
          </g>
        );
      })}
    </>
  );
}

// ─── Atom Glyph ───────────────────────────────────────────────

function AtomGlyph({ cx, cy, radius, fieldCount, stateCount, persistence, effectTypes, color, animated, showLabels, name }: {
  cx: number; cy: number; radius: number; fieldCount: number; stateCount: number;
  persistence: EntityPersistence; effectTypes: string[];
  color: string; animated: boolean; showLabels: boolean; name: string;
}) {
  const coreR = radius * 0.25;
  const spokeInner = coreR + 2;
  const spokeOuter = coreR + radius * 0.15;
  const ringBase = coreR + radius * 0.18;
  const markerR = ringBase + Math.min(stateCount, 5) * (radius * 0.25) * 0.25 + radius * 0.08;

  return (
    <g>
      <PersistenceCore cx={cx} cy={cy} r={coreR} persistence={persistence} color={color} />
      <FieldSpokes cx={cx} cy={cy} innerR={spokeInner} outerR={spokeOuter} count={fieldCount} color={color} />
      <StateRings cx={cx} cy={cy} baseR={ringBase} count={stateCount} color={color} animated={animated} />
      <EffectMarkers cx={cx} cy={cy} r={markerR} effectTypes={effectTypes} baseColor={color} />
      {showLabels && (
        <text
          x={cx} y={cy + radius + 12}
          textAnchor="middle"
          fill={color}
          fontSize={radius * 0.14}
          fontFamily="Inter, sans-serif"
          fontWeight={500}
          opacity={0.8}
        >
          {name}
        </text>
      )}
    </g>
  );
}

// ─── Molecule Glyph ──────────────────────────────────────────

function MoleculeGlyph({ cx, cy, radius, children, color, animated, showLabels, name }: {
  cx: number; cy: number; radius: number; children: BehaviorGlyphChild[];
  color: string; animated: boolean; showLabels: boolean; name: string;
}) {
  const count = children.length || 1;
  const childR = radius / (count <= 3 ? 2.8 : 3.5);
  const orbitR = radius * 0.5;

  return (
    <g>
      {/* Shared event bus ring */}
      <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.3} />

      {/* Child atom glyphs arranged in circle */}
      {children.map((child, i) => {
        const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
        const childCx = cx + orbitR * Math.cos(angle);
        const childCy = cy + orbitR * Math.sin(angle);

        return (
          <g key={child.name}>
            {/* Connection to center */}
            <line x1={cx} y1={cy} x2={childCx} y2={childCy} stroke={color} strokeWidth={0.5} opacity={0.2} />
            <AtomGlyph
              cx={childCx} cy={childCy} radius={childR}
              fieldCount={child.fieldCount ?? 3}
              stateCount={child.stateCount ?? 2}
              persistence={child.persistence ?? 'persistent'}
              effectTypes={child.effectTypes ?? ['render-ui']}
              color={color} animated={animated}
              showLabels={false} name={child.name}
            />
          </g>
        );
      })}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={radius * 0.04} fill={color} opacity={0.5} />

      {showLabels && (
        <text
          x={cx} y={cy + radius + 12}
          textAnchor="middle"
          fill={color}
          fontSize={radius * 0.12}
          fontFamily="Inter, sans-serif"
          fontWeight={500}
          opacity={0.8}
        >
          {name}
        </text>
      )}
    </g>
  );
}

// ─── Organism Glyph ──────────────────────────────────────────

function OrganismGlyph({ cx, cy, radius, children, connections, color, animated, showLabels, name }: {
  cx: number; cy: number; radius: number;
  children: BehaviorGlyphChild[]; connections: BehaviorGlyphConnection[];
  color: string; animated: boolean; showLabels: boolean; name: string;
}) {
  const count = children.length || 1;
  const childR = radius / (count <= 3 ? 3 : 4);
  const spreadX = radius * 0.6;

  // Arrange children in a horizontal line
  const positions = children.map((_, i) => {
    const offset = (i - (count - 1) / 2) * (spreadX * 2 / Math.max(count - 1, 1));
    return { x: cx + offset, y: cy };
  });

  // Build name->index map for connections
  const nameToIdx: Record<string, number> = {};
  children.forEach((c, i) => { nameToIdx[c.name] = i; });

  return (
    <g>
      {/* Boundary */}
      <rect
        x={cx - radius} y={cy - radius * 0.7}
        width={radius * 2} height={radius * 1.4}
        rx={radius * 0.08}
        fill={color} fillOpacity={0.03}
        stroke={color} strokeWidth={0.8} strokeDasharray="6 3" opacity={0.4}
      />

      {/* Connection arrows */}
      {connections.map((conn, i) => {
        const fromIdx = nameToIdx[conn.from];
        const toIdx = nameToIdx[conn.to];
        if (fromIdx == null || toIdx == null) return null;
        const from = positions[fromIdx];
        const to = positions[toIdx];
        return (
          <g key={i}>
            <line
              x1={from.x + childR} y1={from.y}
              x2={to.x - childR} y2={to.y}
              stroke={color} strokeWidth={1} opacity={0.4}
              markerEnd="none"
            />
            {/* Arrow head */}
            <polygon
              points={`${to.x - childR - 4},${to.y - 3} ${to.x - childR},${to.y} ${to.x - childR - 4},${to.y + 3}`}
              fill={color} opacity={0.5}
            />
            {showLabels && (
              <text
                x={(from.x + to.x) / 2}
                y={from.y - childR - 4}
                textAnchor="middle"
                fill={color}
                fontSize={radius * 0.06}
                fontFamily="Inter, sans-serif"
                opacity={0.5}
              >
                {conn.event}
              </text>
            )}
          </g>
        );
      })}

      {/* Child glyphs */}
      {children.map((child, i) => {
        const pos = positions[i];
        return (
          <g key={child.name}>
            <AtomGlyph
              cx={pos.x} cy={pos.y} radius={childR}
              fieldCount={child.fieldCount ?? 3}
              stateCount={child.stateCount ?? 2}
              persistence={child.persistence ?? 'persistent'}
              effectTypes={child.effectTypes ?? ['render-ui']}
              color={color} animated={animated}
              showLabels={showLabels} name={child.name}
            />
          </g>
        );
      })}

      {showLabels && (
        <text
          x={cx} y={cy + radius * 0.7 + 14}
          textAnchor="middle"
          fill={color}
          fontSize={radius * 0.1}
          fontFamily="Inter, sans-serif"
          fontWeight={600}
          opacity={0.8}
        >
          {name}
        </text>
      )}
    </g>
  );
}

// ─── Main Component ──────────────────────────────────────────

export const AvlBehaviorGlyph: React.FC<AvlBehaviorGlyphProps> = ({
  name,
  level = 'atom',
  domain,
  color: colorOverride,
  fieldCount = 4,
  stateCount = 2,
  persistence = 'persistent',
  effectTypes = [],
  children: childBehaviors,
  connections = [],
  size = 'md',
  showLabels = false,
  animated = false,
  className,
  onClick,
}) => {
  const { t } = useTranslate();
  const resolvedColor = colorOverride ?? (domain ? DOMAIN_COLORS[domain] ?? 'var(--color-primary)' : 'var(--color-primary)');
  const dim = SIZE_MAP[size];
  const radius = dim * 0.4;
  const cx = dim / 2;
  const cy = dim / 2;
  const vb = level === 'organism' ? `0 0 ${dim * 1.5} ${dim}` : `0 0 ${dim} ${dim}`;
  const svgW = level === 'organism' ? dim * 1.5 : dim;

  const glyphId = useMemo(() => `avl-bg-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <svg
      viewBox={vb}
      width={svgW}
      height={dim}
      xmlns="http://www.w3.org/2000/svg"
      className={cn('inline-block', onClick && 'cursor-pointer', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={t('avlBehaviorGlyph.ariaLabel', { name })}
    >
      <defs>
        <radialGradient id={`${glyphId}-bg`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={resolvedColor} stopOpacity={0.06} />
          <stop offset="100%" stopColor={resolvedColor} stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* Subtle background glow */}
      <circle cx={level === 'organism' ? dim * 0.75 : cx} cy={cy} r={radius * 1.3} fill={`url(#${glyphId}-bg)`} />

      {level === 'atom' && (
        <AtomGlyph
          cx={cx} cy={cy} radius={radius}
          fieldCount={fieldCount} stateCount={stateCount}
          persistence={persistence} effectTypes={effectTypes}
          color={resolvedColor} animated={animated}
          showLabels={showLabels} name={name}
        />
      )}

      {level === 'molecule' && (
        <MoleculeGlyph
          cx={cx} cy={cy} radius={radius}
          children={childBehaviors ?? []}
          color={resolvedColor} animated={animated}
          showLabels={showLabels} name={name}
        />
      )}

      {level === 'organism' && (
        <OrganismGlyph
          cx={dim * 0.75} cy={cy} radius={radius * 1.5}
          children={childBehaviors ?? []} connections={connections}
          color={resolvedColor} animated={animated}
          showLabels={showLabels} name={name}
        />
      )}
    </svg>
  );
};

AvlBehaviorGlyph.displayName = 'AvlBehaviorGlyph';
