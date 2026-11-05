'use client';

/**
 * AvlOrbitalMachine — a whole mounted orbital on one canvas: every rendering
 * trait is a box nested inside its parent, boxes within `expandDepth` draw
 * their own machine, the rest are compact boxes that open in place, traits
 * that never paint sit in a background lane, and `Trait.EVENT` listens are
 * dashed wires between boxes, drawn only for the chosen trait and the last
 * dispatch's route. Choosing a box emits `selectEvent`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { A11yProps, EventEmit, MountedOrbital, MountedTrait } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useMediaQuery } from '../../../core';
import { domPassthrough } from '../../../core';
import { useContainerWidth } from '../../../hooks/useContainerWidth';
import {
  computeOrbitalLayout,
  loopKey,
  LOOP_LINE,
  roundedEdgePath,
  edgePath,
  type OrbitalBox,
  type OrbitalLayout,
  type OrbitalWire,
} from '../../../lib/avl-elk-layout';
import { AVL_FONT, AVL_INK, AVL_STROKE, avlTint } from '../../../lib/avl-theme';
import { AvlGlyph } from './AvlGlyph';
import { BODY_CHAR, MARGIN, MAX_SCALE, MIN_SCALE, PILL_H, metricsFor } from './AvlStateMachine';

const log = createLogger('almadar:ui:avl:orbital-machine');

export interface AvlOrbitalMachineProps extends A11yProps {
  /** The mounted orbital to draw (`program/self { mounted: true }`).
   * @example {"page":"/orders","traits":[{"trait":"OrderPage","orbital":"Orders","parent":null,"depth":0,"embeddedIn":[],"renders":true,"linked":false,"stepsIn":"browser","linkedEntity":"Order","states":[{"name":"browsing","isInitial":true,"isTerminal":false},{"name":"editing","isInitial":false,"isTerminal":false}],"transitions":[{"index":0,"from":["browsing"],"to":"editing","event":"EDIT","guarded":false,"emits":[]},{"index":1,"from":["editing"],"to":"browsing","event":"CANCEL","guarded":false,"emits":["ORDER_CLOSED"]}],"emits":["ORDER_CLOSED"],"listens":[],"instances":[]}],"wires":[]}
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
  /** The transitions the last dispatch fired, in order: drawn as one numbered route for a moment, then faded. Without it the route is `firedTransition`. @default []
   * @example [{"trait":"OrderPage","index":0}]
   */
  route?: { trait: string; index: number }[];
  /** Boxes at a trait depth below this draw their own machine (when they have more than one state). @default 2 */
  expandDepth?: number;
  /** The trait whose box is marked as chosen. @default "" */
  selectedTrait?: string;
  /** Emitted with the trait's name when a box is chosen. */
  selectEvent?: EventEmit<{ trait: string }>;
  /** The canvas scrolls inside this height. @default "calc(100vh - 9rem)" */
  maxHeight?: string;
  /** Flow direction. @default 'ltr' */
  direction?: 'ltr' | 'rtl';
  className?: string;
}

const MONO = 7.3;
/** How long the last dispatch's route stays drawn before it fades. */
const ROUTE_MS = 2400;
const GLYPH_ROOM = 20;
const NONE: ReadonlySet<string> = new Set<string>();

function wireLabelSize(text: string): { width: number; height: number } {
  return { width: Math.round(text.length * MONO + 16 + GLYPH_ROOM), height: PILL_H - 4 };
}

function toggled(set: ReadonlySet<string>, name: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(name);
  else next.delete(name);
  return next;
}

function activeOf(trait: MountedTrait, activeStates: readonly { trait: string; state: string }[]): string[] {
  const given = activeStates.filter((a) => a.trait === trait.trait).map((a) => a.state);
  return given.length > 0 ? given : trait.instances.map((i) => i.state);
}

export const AvlOrbitalMachine: React.FC<AvlOrbitalMachineProps> = ({
  orbital,
  activeStates = [],
  firedTransition = null,
  route = [],
  expandDepth = 2,
  selectedTrait = '',
  selectEvent,
  maxHeight = 'calc(100vh - 9rem)',
  direction = 'ltr',
  className,
  ...rest
}) => {
  const passthrough = domPassthrough(rest);
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const [open, setOpen] = useState<ReadonlySet<string>>(NONE);
  const [closed, setClosed] = useState<ReadonlySet<string>>(NONE);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hostRef = useRef<HTMLDivElement>(null);
  const hostWidth = useContainerWidth(hostRef);
  const [layout, setLayout] = useState<OrbitalLayout | null>(null);
  const [layoutFailed, setLayoutFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hotWire, setHotWire] = useState<string | null>(null);
  const [openLoops, setOpenLoops] = useState<ReadonlySet<string>>(NONE);
  const [routeOn, setRouteOn] = useState(false);
  const steps = useMemo(() => (route.length > 0 ? route : firedTransition === null ? [] : [firedTransition]), [route, firedTransition]);
  const routeKey = JSON.stringify(steps);
  const orbitalKey = useMemo(() => JSON.stringify(orbital), [orbital]);
  const metrics = useMemo(() => metricsFor('pill', direction), [direction]);

  const select = useCallback((trait: string) => {
    if (selectEvent) eventBus.emit(`UI:${selectEvent}`, { trait });
  }, [eventBus, selectEvent]);

  const setExpanded = useCallback((trait: string, expanded: boolean) => {
    setOpen((s) => toggled(s, trait, expanded));
    setClosed((s) => toggled(s, trait, !expanded));
  }, []);

  useEffect(() => {
    let live = true;
    setLayoutFailed(false);
    computeOrbitalLayout(orbital, { expandDepth, open, closed, openLoops, metrics, charWidth: BODY_CHAR, wireLabelSize })
      .then((l) => { if (live) setLayout(l); })
      .catch((error) => {
        log.error('layout-failed', { page: orbital.page, error: error instanceof Error ? error : String(error) });
        if (live) setLayoutFailed(true);
      });
    return () => { live = false; };
    // orbital is captured by its serialized key.
  }, [orbitalKey, expandDepth, open, closed, openLoops, metrics, attempt]);

  useEffect(() => {
    if (steps.length === 0) { setRouteOn(false); return; }
    setRouteOn(true);
    const timer = setTimeout(() => setRouteOn(false), ROUTE_MS);
    return () => clearTimeout(timer);
    // steps is captured by its serialized key: a new dispatch restarts the route.
  }, [routeKey]);

  const routeStep = useMemo(() => new Map(steps.map((st, i) => [`${st.trait}:${st.index}`, i + 1])), [steps]);
  const routeFirst = useMemo(() => {
    const out = new Map<string, number>();
    steps.forEach((st, i) => { if (!out.has(st.trait)) out.set(st.trait, i); });
    return out;
  }, [steps]);

  const traits = useMemo(() => new Map(orbital.traits.map((tr) => [tr.trait, tr])), [orbital]);
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
  const motion = reduceMotion ? 'none' : 'box-shadow 250ms ease-out, border-color 250ms ease-out';
  const inkMotion = reduceMotion ? 'none' : 'stroke 250ms ease-out, stroke-opacity 250ms ease-out, opacity 250ms ease-out';
  const onRoute = (trait: string, index: number) => routeOn && routeStep.has(`${trait}:${index}`);
  const isNext = (trait: string, from: string) => actives.get(trait)?.has(from) === true;
  const guarded = (trait: string, index: number) => traits.get(trait)?.transitions.find((x) => x.index === index)?.guarded === true;
  const wireOnRoute = (from: string, to: string) => {
    const a = routeFirst.get(from);
    const b = routeFirst.get(to);
    return routeOn && a !== undefined && b !== undefined && a < b;
  };
  const toggleLoops = (key: string) => setOpenLoops((s) => toggled(s, key, !s.has(key)));
  // A wire draws only while it carries the last dispatch or touches the chosen trait: every other delivery stays out of sight.
  const shownWires = layout.wires.filter((wire) => wireOnRoute(wire.from, wire.to) || wire.from === selectedTrait || wire.to === selectedTrait);

  const renderBox = (box: OrbitalBox, parent: OrbitalBox | null, depth: number): React.ReactNode => {
    const trait = traits.get(box.trait);
    if (trait === undefined) return null;
    const active = [...(actives.get(box.trait) ?? [])];
    const children = layout.boxes.filter((b) => b.parent === box.trait && !b.lane);
    const expanded = box.kind === 'machine';
    const opens = box.kind !== 'chip';
    const chosen = selectedTrait === box.trait;
    const headH = expanded ? 46 : 38;
    const label = active.length > 0
      ? t('stateMachine.boxLabel', { trait: trait.trait, state: active.join(', '), count: trait.states.length })
      : t('stateMachine.boxLabelIdle', { trait: trait.trait, count: trait.states.length });
    const fired = routeOn && routeFirst.has(box.trait);

    const head = (
      <Box
        className="absolute left-0 top-0 flex w-full items-center gap-1 px-1"
        style={{ height: box.container || expanded ? headH : '100%', fontFamily: AVL_FONT.body }}
      >
        {opens ? (
          <Button
            data-testid="avl-om-toggle"
            variant="ghost"
            size="sm"
            className="shrink-0 px-1"
            icon={expanded ? 'chevron-down' : direction === 'rtl' ? 'chevron-left' : 'chevron-right'}
            aria-expanded={expanded}
            aria-label={t(expanded ? 'stateMachine.collapse' : 'stateMachine.expand', { trait: trait.trait })}
            onClick={() => setExpanded(box.trait, !expanded)}
          />
        ) : null}
        <Box
          data-testid="avl-om-head"
          role="button"
          tabIndex={0}
          aria-pressed={chosen}
          aria-label={label}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch rounded-md px-1 transition-colors duration-150 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => select(box.trait)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(box.trait); }
          }}
        >
          <AvlGlyph kind="trait" size="xs" showCaption={false} aria-hidden="true" className="shrink-0" />
          <Box className="flex min-w-0 flex-col">
            <Box className="flex min-w-0 items-center gap-2">
              <Box as="span" className="truncate" style={{ fontSize: 13, fontWeight: 600, color: AVL_INK.text }}>{trait.trait}</Box>
              {box.kind === 'collapsed' && active.length > 0 ? (
                <Box
                  as="span"
                  data-testid="avl-om-state"
                  className="shrink-0 rounded-full px-1.5"
                  style={{ fontSize: 11, fontWeight: 600, background: AVL_INK.focus, color: AVL_INK.onFocus }}
                >
                  {active.join(', ')}
                </Box>
              ) : null}
            </Box>
            {trait.linkedEntity !== null && box.kind !== 'chip' ? (
              <Box as="span" className="truncate" style={{ fontSize: 11, color: AVL_INK.quiet }}>{trait.linkedEntity}</Box>
            ) : null}
          </Box>
        </Box>
      </Box>
    );

    return (
      <Box
        key={box.trait}
        data-testid="avl-om-box"
        data-trait={box.trait}
        data-kind={box.kind}
        data-lane={box.lane ? 'true' : 'false'}
        data-pulse={fired ? 'true' : 'false'}
        data-selected={chosen ? 'true' : 'false'}
        className="absolute rounded-xl"
        style={{
          left: box.x - (parent?.x ?? 0),
          top: box.y - (parent?.y ?? 0),
          width: box.width,
          height: box.height,
          background: depth % 2 === 0 ? AVL_INK.surface : AVL_INK.wash,
          border: `${chosen ? 2 : 1}px solid ${fired || chosen ? AVL_INK.focus : AVL_INK.line}`,
          boxShadow: fired ? `0 0 0 4px ${avlTint(AVL_INK.focus, 28)}` : 'var(--shadow-sm)',
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
      <Box ref={hostRef} className="min-w-0 max-w-full overflow-auto" style={{ width: '100%', minWidth: 0, maxHeight }}>
        <Box className="relative" style={{ width: w * scale, height: h * scale, marginInline: w * scale < (hostWidth ?? 0) ? 'auto' : 0 }}>
          <Box className="absolute left-0 top-0" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <Box className="absolute" style={{ left: MARGIN, top: MARGIN, width: layout.width, height: layout.height }}>
              {layout.groupTop !== null ? (
                <Box data-testid="avl-om-linked" className="absolute" style={{ left: 0, top: layout.groupTop, width: layout.width }}>
                  <Typography variant="caption" color="muted">{t('stateMachine.linked')}</Typography>
                </Box>
              ) : null}
              {layout.groups.map((g) => (
                <Box
                  key={`group-${g.orbital}`}
                  data-testid="avl-om-group"
                  data-orbital={g.orbital}
                  className="absolute rounded-xl"
                  style={{ left: g.x, top: g.y, width: g.width, height: g.height, border: `1px dashed ${AVL_INK.line}`, background: AVL_INK.canvas }}
                >
                  <Box className="flex items-center gap-2 px-3" style={{ height: 38, fontFamily: AVL_FONT.body }}>
                    <AvlGlyph kind="orbital" size="xs" showCaption={false} aria-hidden="true" className="shrink-0" />
                    <Box as="span" className="truncate" style={{ fontSize: 13, fontWeight: 600, color: AVL_INK.quiet }}>{g.orbital}</Box>
                  </Box>
                </Box>
              ))}
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
                <marker id="avl-om-head-next" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10z" fill={AVL_INK.focus} fillOpacity={0.55} />
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
                  const fired = onRoute(e.trait, e.index);
                  const lit = fired || hot.get(e.trait)?.has(e.index) === true;
                  const next = !lit && isNext(e.trait, e.from);
                  return (
                    <path
                      key={e.id}
                      data-testid="avl-om-transition"
                      data-trait={e.trait}
                      data-event={e.event}
                      data-fired={fired ? 'true' : 'false'}
                      data-hot={lit ? 'true' : 'false'}
                      data-next={next ? 'true' : 'false'}
                      d={roundedEdgePath(e.points, 10)}
                      fill="none"
                      stroke={lit || next ? AVL_INK.focus : AVL_INK.quiet}
                      strokeOpacity={lit ? 1 : next ? 0.5 : 0.3}
                      strokeWidth={lit ? AVL_STROKE.active : AVL_STROKE.wire}
                      markerEnd={`url(#avl-om-head${lit ? '-hot' : next ? '-next' : ''})`}
                      style={{ transition: inkMotion }}
                    />
                  );
                })}
                {shownWires.map((wire) => {
                  const lit = hotWire === wire.key || wireOnRoute(wire.from, wire.to);
                  const d = wirePath(wire);
                  const caption = t('stateMachine.wireLabel', { from: wire.from, event: [...new Set(wire.pairs.map((p) => p.event))].join(', '), to: wire.to });
                  return (
                    <g key={wire.key} data-testid="avl-om-wire" data-from={wire.from} data-to={wire.to} data-hot={lit ? 'true' : 'false'}>
                      <path d={d} fill="none" stroke={lit ? AVL_INK.focus : AVL_INK.quiet} strokeOpacity={lit ? 1 : 0.45} strokeWidth={lit ? AVL_STROKE.active : AVL_STROKE.wire} strokeDasharray="6 4" markerEnd={`url(#avl-om-head${lit ? '-hot' : ''})`} style={{ transition: inkMotion }} />
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
                const step = routeOn ? routeStep.get(`${e.trait}:${e.index}`) : undefined;
                const emphasis = step !== undefined || hot.get(e.trait)?.has(e.index) === true;
                const next = !emphasis && isNext(e.trait, e.from);
                return (
                  <Box
                    key={`label-${e.id}`}
                    data-testid="avl-om-label"
                    data-trait={e.trait}
                    data-event={e.event}
                    data-next={next ? 'true' : 'false'}
                    className="absolute flex items-center justify-center rounded-md px-2"
                    style={{
                      left: e.labelX, top: e.labelY, width: e.labelW, height: e.labelH,
                      background: AVL_INK.surface,
                      border: `1px solid ${emphasis || next ? AVL_INK.focus : AVL_INK.line}`,
                      fontFamily: AVL_FONT.mono, fontSize: 12,
                      color: emphasis ? AVL_INK.focus : next ? AVL_INK.text : AVL_INK.quiet,
                      fontWeight: emphasis ? 600 : 400,
                      transition: motion,
                    }}
                  >
                    <Box as="span" className="whitespace-nowrap">{e.event}</Box>
                    {step !== undefined ? (
                      <Box
                        as="span"
                        data-testid="avl-om-step"
                        className="absolute flex items-center justify-center rounded-full"
                        style={{ left: -9, top: -9, width: 18, height: 18, fontSize: 10, fontWeight: 700, background: AVL_INK.focus, color: AVL_INK.onFocus }}
                      >
                        {step}
                      </Box>
                    ) : null}
                    {next && guarded(e.trait, e.index) ? (
                      <Box as="span" data-testid="avl-om-guard" className="absolute" style={{ right: -10, top: -10 }}>
                        <AvlGlyph kind="guard" size="xs" showCaption={false} aria-label={t('stateMachine.guarded')} />
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
              {shownWires.map((wire) => (
                <Box
                  key={`wire-label-${wire.key}`}
                  data-testid="avl-om-wire-label"
                  data-from={wire.from}
                  data-to={wire.to}
                  className="absolute flex items-center justify-center gap-1 rounded-md px-1"
                  style={{
                    left: wire.labelX, top: wire.labelY, width: wire.labelW, height: wire.labelH,
                    background: AVL_INK.canvas,
                    border: `1px dashed ${hotWire === wire.key ? AVL_INK.focus : AVL_INK.line}`,
                    fontFamily: AVL_FONT.mono, fontSize: 11, color: AVL_INK.quiet,
                  }}
                >
                  <AvlGlyph kind="event" size="xs" showCaption={false} aria-hidden="true" className="shrink-0" />
                  <Box as="span" data-testid="avl-om-wire-event" className="whitespace-nowrap">{[...new Set(wire.pairs.map((p) => p.event))].join(', ')}</Box>
                </Box>
              ))}
              {layout.states.map((s) => {
                const active = actives.get(s.trait)?.has(s.name) === true;
                const loop = layout.loops.find((l) => l.trait === s.trait && l.state === s.name);
                const loopFired = loop !== undefined && loop.events.some((ev) => onRoute(s.trait, ev.index));
                return (
                  <Box
                    key={`${s.trait}:${s.name}`}
                    data-testid="avl-om-state-node"
                    data-trait={s.trait}
                    data-state={s.name}
                    data-active={active ? 'true' : 'false'}
                    className="absolute flex flex-col items-center justify-center gap-1 rounded-lg"
                    style={{
                      left: s.x, top: s.y, width: s.width, height: s.height,
                      background: active ? avlTint(AVL_INK.focus, 10) : AVL_INK.surface,
                      border: `${active ? 2 : 1}px solid ${active ? AVL_INK.focus : AVL_INK.line}`,
                      boxShadow: s.isTerminal ? `0 0 0 3px ${AVL_INK.surface}, 0 0 0 4px ${AVL_INK.line}` : 'var(--shadow-sm)',
                      fontFamily: AVL_FONT.body, fontSize: 13, fontWeight: active ? 600 : 500, color: active ? AVL_INK.text : AVL_INK.quiet,
                    }}
                  >
                    <Box as="span">{s.name}</Box>
                    {loop !== undefined ? (
                      <Box
                        data-testid="avl-om-loops"
                        role="button"
                        tabIndex={0}
                        aria-expanded={loop.open}
                        aria-label={t('stateMachine.selfEvents', { state: s.name, count: loop.events.length })}
                        className="flex cursor-pointer items-center gap-1 rounded-full px-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{
                          pointerEvents: 'auto', fontSize: 11, fontWeight: 600,
                          background: loopFired && routeOn ? AVL_INK.focus : AVL_INK.wash,
                          color: loopFired && routeOn ? AVL_INK.onFocus : AVL_INK.quiet,
                          transition: motion,
                        }}
                        onClick={() => toggleLoops(loopKey(s.trait, s.name))}
                        onKeyDown={(ev: React.KeyboardEvent) => {
                          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleLoops(loopKey(s.trait, s.name)); }
                        }}
                      >
                        <Icon name="repeat" size="xs" />
                        {loop.events.length}
                      </Box>
                    ) : null}
                    {loop?.open === true ? (
                      <Box data-testid="avl-om-loop-list" className="flex flex-col items-center" style={{ fontFamily: AVL_FONT.mono, fontSize: 11 }}>
                        {loop.events.map((ev) => (
                          <Box
                            as="span"
                            key={`${ev.index}`}
                            data-fired={onRoute(s.trait, ev.index) ? 'true' : 'false'}
                            className="whitespace-nowrap"
                            style={{ lineHeight: `${LOOP_LINE}px`, color: onRoute(s.trait, ev.index) ? AVL_INK.focus : active ? AVL_INK.text : AVL_INK.quiet, fontWeight: onRoute(s.trait, ev.index) ? 600 : 400 }}
                          >
                            {ev.event}
                          </Box>
                        ))}
                      </Box>
                    ) : null}
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
