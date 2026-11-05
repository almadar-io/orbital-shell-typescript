'use client';

/**
 * AvlOrbitalMachine — a whole mounted orbital on one canvas: every rendering
 * trait is a box nested inside its parent, boxes within `expandDepth` draw
 * their own machine, the rest are compact boxes whose full machine opens on
 * hover or focus, traits that never paint sit in a background lane, and
 * `Trait.EVENT` listens are dashed wires between boxes.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { A11yProps, MountedOrbital, MountedTrait } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { useTranslate } from '../../../core';
import { useMediaQuery } from '../../../core';
import { domPassthrough } from '../../../core';
import { useContainerWidth } from '../../../hooks/useContainerWidth';
import {
  computeOrbitalLayout,
  roundedEdgePath,
  edgePath,
  type OrbitalBox,
  type OrbitalLayout,
  type OrbitalWire,
} from '../../../lib/avl-elk-layout';
import { AVL_FONT, AVL_INK, AVL_STROKE, avlTint } from '../../../lib/avl-theme';
import { traitLevelFromMounted } from '../../../lib/avl-schema-parser';
import { Popover } from '../../core/molecules/Popover';
import { AvlStateMachine, BODY_CHAR, MARGIN, MAX_SCALE, MIN_SCALE, PILL_H, metricsFor } from './AvlStateMachine';

const log = createLogger('almadar:ui:avl:orbital-machine');

export interface AvlOrbitalMachineProps extends A11yProps {
  /** The mounted orbital to draw (`program/self { mounted: true }`).
   * @example {"page":"/orders","traits":[{"trait":"OrderPage","orbital":"Orders","parent":null,"depth":0,"embeddedIn":[],"renders":true,"stepsIn":"browser","linkedEntity":"Order","states":[{"name":"browsing","isInitial":true,"isTerminal":false},{"name":"editing","isInitial":false,"isTerminal":false}],"transitions":[{"index":0,"from":["browsing"],"to":"editing","event":"EDIT","guarded":false,"emits":[]},{"index":1,"from":["editing"],"to":"browsing","event":"CANCEL","guarded":false,"emits":["ORDER_CLOSED"]}],"emits":["ORDER_CLOSED"],"listens":[],"instances":[]}]}
   */
  orbital: MountedOrbital;
  /** Current state per trait; a trait without an entry shows the states of its running instances. @default []
   * @example [{"trait":"OrderPage","state":"browsing"}]
   */
  activeStates?: { trait: string; state: string }[];
  /** The last fired transition: its trait and its `index`. @default null
   * @example {"trait":"OrderPage","index":0}
   */
  firedTransition?: { trait: string; index: number } | null;
  /** Boxes at a trait depth below this draw their own machine (when they have more than one state). @default 2 */
  expandDepth?: number;
  /** Flow direction. @default 'ltr' */
  direction?: 'ltr' | 'rtl';
  className?: string;
}

const MONO = 7.3;
const PULSE_MS = 700;

function wireLabelSize(text: string): { width: number; height: number } {
  return { width: Math.round(text.length * MONO + 16), height: PILL_H - 4 };
}

function activeOf(trait: MountedTrait, activeStates: readonly { trait: string; state: string }[]): string[] {
  const given = activeStates.filter((a) => a.trait === trait.trait).map((a) => a.state);
  return given.length > 0 ? given : trait.instances.map((i) => i.state);
}

export const AvlOrbitalMachine: React.FC<AvlOrbitalMachineProps> = ({
  orbital,
  activeStates = [],
  firedTransition = null,
  expandDepth = 2,
  direction = 'ltr',
  className,
  ...rest
}) => {
  const passthrough = domPassthrough(rest);
  const { t } = useTranslate();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hostRef = useRef<HTMLDivElement>(null);
  const hostWidth = useContainerWidth(hostRef);
  const [layout, setLayout] = useState<OrbitalLayout | null>(null);
  const [layoutFailed, setLayoutFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hotWire, setHotWire] = useState<string | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const orbitalKey = useMemo(() => JSON.stringify(orbital), [orbital]);
  const metrics = useMemo(() => metricsFor('pill', direction), [direction]);

  useEffect(() => {
    let live = true;
    setLayoutFailed(false);
    computeOrbitalLayout(orbital, { expandDepth, metrics, charWidth: BODY_CHAR, wireLabelSize })
      .then((l) => { if (live) setLayout(l); })
      .catch((error) => {
        log.error('layout-failed', { page: orbital.page, error: error instanceof Error ? error : String(error) });
        if (live) setLayoutFailed(true);
      });
    return () => { live = false; };
    // orbital is captured by its serialized key.
  }, [orbitalKey, expandDepth, metrics, attempt]);

  useEffect(() => {
    if (firedTransition === null) return;
    setPulse(firedTransition.trait);
    const timer = setTimeout(() => setPulse(null), PULSE_MS);
    return () => clearTimeout(timer);
  }, [firedTransition]);

  const traits = useMemo(() => new Map(orbital.traits.map((tr) => [tr.trait, tr])), [orbital]);
  const levels = useMemo(() => new Map(orbital.traits.map((tr) => [tr.trait, traitLevelFromMounted(tr)])), [orbital]);
  const actives = useMemo(
    () => new Map(orbital.traits.map((tr) => [tr.trait, new Set(activeOf(tr, activeStates))])),
    [orbital, activeStates],
  );

  const hot = useMemo(() => {
    const out = new Map<string, Set<number>>();
    const wire = layout?.wires.find((w) => w.key === hotWire);
    if (wire === undefined) return out;
    const add = (trait: string, index: number) => out.set(trait, (out.get(trait) ?? new Set<number>()).add(index));
    for (const pair of wire.pairs) {
      for (const tr of traits.get(wire.from)?.transitions ?? []) if (tr.emits.includes(pair.event)) add(wire.from, tr.index);
      for (const tr of traits.get(wire.to)?.transitions ?? []) if (pair.triggers !== null && tr.event === pair.triggers) add(wire.to, tr.index);
    }
    return out;
  }, [layout, hotWire, traits]);

  if (layoutFailed) {
    return (
      <Box role="alert" className="flex flex-col items-center justify-center gap-2 py-10">
        <Typography variant="caption" color="muted">{t('avl.layoutFailed')}</Typography>
        <Button variant="ghost" size="sm" label={t('common.retry')} onClick={() => setAttempt((n) => n + 1)} />
      </Box>
    );
  }
  if (layout === null) {
    return (
      <Box className="flex items-center justify-center py-10">
        <Typography variant="caption" color="muted">{t('avl.computingLayout')}</Typography>
      </Box>
    );
  }

  const w = layout.width + 2 * MARGIN;
  const h = layout.height + 2 * MARGIN;
  const fit = hostWidth ? hostWidth / w : 1;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit));
  const pulseShadow = (trait: string) => (pulse === trait ? `0 0 0 4px ${avlTint(AVL_INK.focus, 28)}` : 'none');
  const motion = reduceMotion ? 'none' : 'box-shadow 400ms ease-out, border-color 400ms ease-out';

  const renderBox = (box: OrbitalBox, parent: OrbitalBox | null, depth: number): React.ReactNode => {
    const trait = traits.get(box.trait);
    const level = levels.get(box.trait);
    if (trait === undefined || level === undefined) return null;
    const active = [...(actives.get(box.trait) ?? [])];
    const children = layout.boxes.filter((b) => b.parent === box.trait && !b.lane);
    const compact = box.kind !== 'machine';
    const headH = box.kind === 'machine' ? 46 : 38;
    const label = active.length > 0
      ? t('stateMachine.boxLabel', { trait: trait.trait, state: active.join(', '), count: trait.states.length })
      : t('stateMachine.boxLabelIdle', { trait: trait.trait, count: trait.states.length });
    const fired = pulse === box.trait;

    const heading = (
      <Box className="flex h-full w-full flex-col justify-center px-3" style={{ fontFamily: AVL_FONT.body, pointerEvents: 'none' }}>
        <Box className="flex items-center gap-2">
          <Box as="span" style={{ fontSize: 13, fontWeight: 600, color: AVL_INK.text }}>{trait.trait}</Box>
          {compact && box.kind === 'collapsed' && active.length > 0 ? (
            <Box
              as="span"
              data-testid="avl-om-state"
              className="rounded-full px-1.5"
              style={{ fontSize: 11, fontWeight: 600, background: AVL_INK.focus, color: AVL_INK.onFocus }}
            >
              {active.join(', ')}
            </Box>
          ) : null}
        </Box>
        {box.kind !== 'chip' ? (
          <Box as="span" style={{ fontSize: 11, color: AVL_INK.quiet }}>
            {trait.linkedEntity !== null ? `${trait.linkedEntity} · ` : ''}{t('avl.stateCount', { count: trait.states.length })}
          </Box>
        ) : trait.linkedEntity !== null ? (
          <Box as="span" style={{ fontSize: 11, color: AVL_INK.quiet }}>{trait.linkedEntity}</Box>
        ) : null}
      </Box>
    );

    const head = compact ? (
      <Popover
        trigger="hover"
        position="bottom"
        content={
          <Box style={{ minWidth: 320 }}>
            <AvlStateMachine trait={level} activeState={active[0]} activeTransition={firedTransition?.trait === box.trait ? firedTransition.index : undefined} />
          </Box>
        }
      >
        <Box
          data-testid="avl-om-head"
          tabIndex={0}
          role="group"
          aria-label={label}
          className="absolute left-0 top-0 w-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ height: box.container ? headH : '100%', cursor: 'help' }}
        >
          {heading}
        </Box>
      </Popover>
    ) : (
      <Box className="absolute left-0 top-0 w-full" style={{ height: headH, pointerEvents: 'none' }}>{heading}</Box>
    );

    return (
      <Box
        key={box.trait}
        data-testid="avl-om-box"
        data-trait={box.trait}
        data-kind={box.kind}
        data-lane={box.lane ? 'true' : 'false'}
        data-pulse={fired ? 'true' : 'false'}
        className="absolute rounded-xl"
        style={{
          left: box.x - (parent?.x ?? 0),
          top: box.y - (parent?.y ?? 0),
          width: box.width,
          height: box.height,
          background: depth % 2 === 0 ? AVL_INK.surface : AVL_INK.wash,
          border: `1px solid ${fired ? AVL_INK.focus : AVL_INK.line}`,
          boxShadow: fired ? pulseShadow(box.trait) : 'var(--shadow-sm)',
          transition: motion,
        }}
      >
        {head}
        {children.map((c) => renderBox(c, box, depth + 1))}
      </Box>
    );
  };

  const roots = layout.boxes.filter((b) => b.parent === null && !b.lane);
  const laneBoxes = layout.boxes.filter((b) => b.lane);
  const wirePath = (wire: OrbitalWire) => (wire.points.length > 2 ? roundedEdgePath(wire.points, 10) : edgePath(wire.points));

  return (
    <Box data-testid="avl-orbital-machine" className={`min-w-0 max-w-full ${className ?? ''}`} style={{ width: '100%', minWidth: 0 }} {...passthrough}>
      <Box ref={hostRef} className="min-w-0 max-w-full overflow-auto" style={{ width: '100%', minWidth: 0, maxHeight: 'calc(100vh - 9rem)' }}>
        <Box className="relative" style={{ width: w * scale, height: h * scale, marginInline: w * scale < (hostWidth ?? 0) ? 'auto' : 0 }}>
          <Box className="absolute left-0 top-0" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <Box className="absolute" style={{ left: MARGIN, top: MARGIN, width: layout.width, height: layout.height }}>
              {roots.map((b) => renderBox(b, null, 0))}
              {layout.laneTop !== null ? (
                <Box data-testid="avl-om-lane" className="absolute" style={{ left: 0, top: layout.laneTop, width: layout.width }}>
                  <Typography variant="caption" color="muted">{t('stateMachine.background')}</Typography>
                </Box>
              ) : null}
              {laneBoxes.map((b) => renderBox(b, null, 0))}
            </Box>

            <svg width={w} height={h} className="absolute left-0 top-0 overflow-visible" style={{ pointerEvents: 'none' }} aria-hidden="true">
              <defs>
                <marker id="avl-om-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10z" fill={AVL_INK.quiet} fillOpacity={0.8} />
                </marker>
                <marker id="avl-om-head-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10z" fill={AVL_INK.focus} />
                </marker>
              </defs>
              <g transform={`translate(${MARGIN},${MARGIN})`}>
                {layout.states.filter((s) => s.isInitial).map((s) => {
                  const cy = s.y + s.height / 2;
                  return (
                    <g key={`init-${s.trait}-${s.name}`}>
                      <circle cx={s.x - 18} cy={cy} r={4} fill={AVL_INK.text} />
                      <path d={`M ${s.x - 13} ${cy} H ${s.x - 1}`} stroke={AVL_INK.quiet} strokeWidth={AVL_STROKE.wire} markerEnd="url(#avl-om-head)" />
                    </g>
                  );
                })}
                {layout.embeds.map((e) => (
                  <path key={`embed-${e.trait}-${e.state}`} data-testid="avl-om-embed" data-trait={e.trait} data-state={e.state} d={edgePath(e.points)} fill="none" stroke={AVL_INK.quiet} strokeOpacity={0.6} strokeWidth={AVL_STROKE.hairline} strokeDasharray="1 4" strokeLinecap="round" />
                ))}
                {layout.edges.map((e) => {
                  const fired = firedTransition?.trait === e.trait && firedTransition.index === e.index;
                  const lit = hot.get(e.trait)?.has(e.index) === true;
                  return (
                    <path
                      key={e.id}
                      data-testid="avl-om-transition"
                      data-trait={e.trait}
                      data-event={e.event}
                      data-fired={fired ? 'true' : 'false'}
                      data-hot={lit ? 'true' : 'false'}
                      d={roundedEdgePath(e.points, 10)}
                      fill="none"
                      stroke={fired || lit ? AVL_INK.focus : AVL_INK.quiet}
                      strokeOpacity={fired || lit ? 1 : 0.55}
                      strokeWidth={fired || lit ? AVL_STROKE.active : AVL_STROKE.wire}
                      markerEnd={`url(#avl-om-head${fired || lit ? '-hot' : ''})`}
                    />
                  );
                })}
                {layout.states.filter((s) => actives.get(s.trait)?.has(s.name) === true).map((s) => (
                  <rect key={`ring-${s.trait}-${s.name}`} x={s.x - 5} y={s.y - 5} width={s.width + 10} height={s.height + 10} rx={12} fill="none" stroke={AVL_INK.focus} strokeWidth={4} strokeOpacity={0.22} />
                ))}
                {layout.wires.map((wire) => {
                  const lit = hotWire === wire.key;
                  const d = wirePath(wire);
                  const caption = t('stateMachine.wireLabel', { from: wire.from, event: [...new Set(wire.pairs.map((p) => p.event))].join(', '), to: wire.to });
                  return (
                    <g key={wire.key} data-testid="avl-om-wire" data-from={wire.from} data-to={wire.to} data-hot={lit ? 'true' : 'false'}>
                      <path d={d} fill="none" stroke={lit ? AVL_INK.focus : AVL_INK.quiet} strokeOpacity={lit ? 1 : 0.75} strokeWidth={lit ? AVL_STROKE.active : AVL_STROKE.wire} strokeDasharray="6 4" markerEnd={`url(#avl-om-head${lit ? '-hot' : ''})`} />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        tabIndex={0}
                        role="img"
                        aria-label={caption}
                        style={{ pointerEvents: 'stroke', cursor: 'help', outline: 'none' }}
                        onMouseEnter={() => setHotWire(wire.key)}
                        onMouseLeave={() => setHotWire(null)}
                        onFocus={() => setHotWire(wire.key)}
                        onBlur={() => setHotWire(null)}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>

            <Box className="absolute" style={{ left: MARGIN, top: MARGIN, width: layout.width, height: layout.height, pointerEvents: 'none' }}>
              {layout.edges.map((e) => {
                const fired = firedTransition?.trait === e.trait && firedTransition.index === e.index;
                const lit = hot.get(e.trait)?.has(e.index) === true;
                const emphasis = fired || lit;
                return (
                  <Box
                    key={`label-${e.id}`}
                    data-testid="avl-om-label"
                    data-trait={e.trait}
                    data-event={e.event}
                    className="absolute flex items-center justify-center rounded-md px-2"
                    style={{
                      left: e.labelX, top: e.labelY, width: e.labelW, height: e.labelH,
                      background: AVL_INK.surface,
                      border: `1px solid ${emphasis ? AVL_INK.focus : AVL_INK.line}`,
                      fontFamily: AVL_FONT.mono, fontSize: 12,
                      color: emphasis ? AVL_INK.focus : AVL_INK.text,
                      fontWeight: emphasis ? 600 : 400,
                    }}
                  >
                    <Box as="span" className="whitespace-nowrap">{e.event}</Box>
                  </Box>
                );
              })}
              {layout.wires.map((wire) => (
                <Box
                  key={`wire-label-${wire.key}`}
                  data-testid="avl-om-wire-label"
                  data-from={wire.from}
                  data-to={wire.to}
                  className="absolute flex items-center justify-center rounded-md px-1"
                  style={{
                    left: wire.labelX, top: wire.labelY, width: wire.labelW, height: wire.labelH,
                    background: AVL_INK.canvas,
                    border: `1px dashed ${hotWire === wire.key ? AVL_INK.focus : AVL_INK.line}`,
                    fontFamily: AVL_FONT.mono, fontSize: 11, color: AVL_INK.quiet,
                  }}
                >
                  <Box as="span" className="whitespace-nowrap">{[...new Set(wire.pairs.map((p) => p.event))].join(', ')}</Box>
                </Box>
              ))}
              {layout.states.map((s) => {
                const active = actives.get(s.trait)?.has(s.name) === true;
                return (
                  <Box
                    key={`${s.trait}:${s.name}`}
                    data-testid="avl-om-state-node"
                    data-trait={s.trait}
                    data-state={s.name}
                    data-active={active ? 'true' : 'false'}
                    className="absolute flex items-center justify-center rounded-lg"
                    style={{
                      left: s.x, top: s.y, width: s.width, height: s.height,
                      background: AVL_INK.surface,
                      border: `${active ? 2 : 1}px solid ${active ? AVL_INK.focus : AVL_INK.line}`,
                      boxShadow: s.isTerminal ? `0 0 0 3px ${AVL_INK.surface}, 0 0 0 4px ${AVL_INK.line}` : 'var(--shadow-sm)',
                      fontFamily: AVL_FONT.body, fontSize: 13, fontWeight: active ? 600 : 500, color: AVL_INK.text,
                    }}
                  >
                    {s.name}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

AvlOrbitalMachine.displayName = 'AvlOrbitalMachine';
