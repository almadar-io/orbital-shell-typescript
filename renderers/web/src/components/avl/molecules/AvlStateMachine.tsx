'use client';

/**
 * AvlStateMachine — the one state-machine renderer: a trait's states and
 * transitions laid out left→right (ELK), themed entirely through tokens, with
 * optional execution position (active state, fired transition, visited path).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatSExpr, type A11yProps, type EventEmit } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useMediaQuery } from '../../../core';
import { useContainerWidth } from '../../../hooks/useContainerWidth';
import { domPassthrough } from '../../../core';
import { gearTeethPath } from '../../../lib/jazari/svg-paths';
import { computeTraitLayout, roundedEdgePath, type ElkLayout, type TraitLayoutMetrics } from '../../../lib/avl-elk-layout';
import { AVL_FONT, AVL_INK, AVL_STROKE, avlTint } from '../../../lib/avl-theme';
import type { TraitLevelData } from '../../../lib/avl-schema-parser';
import type { AvlAnnotations } from '../../../lib/avl-annotations';
import { AvlEffectChip } from './AvlEffectChip';
import { AvlExplain } from './AvlExplain';

const log = createLogger('almadar:ui:avl:state-machine');

export interface AvlStateMachineProps extends A11yProps {
  /** The trait to draw (see `parseTraitLevel`).
   * @example {"name":"OrderFlow","linkedEntity":"Order","states":[{"name":"browsing","isInitial":true,"isTerminal":false},{"name":"editing","isInitial":false,"isTerminal":false},{"name":"saving","isInitial":false,"isTerminal":false},{"name":"confirmed","isInitial":false,"isTerminal":true},{"name":"failed","isInitial":false,"isTerminal":false}],"transitions":[{"from":"browsing","to":"editing","event":"EDIT","effects":[{"type":"render-ui","args":[]}],"index":0},{"from":"editing","to":"saving","event":"SAVE","effects":[{"type":"persist","args":[]},{"type":"notify","args":[]}],"index":1},{"from":"saving","to":"confirmed","event":"SAVED","effects":[{"type":"emit","args":[]},{"type":"render-ui","args":[]}],"index":2},{"from":"saving","to":"failed","event":"SAVE_FAILED","effects":[{"type":"notify","args":[]}],"index":3},{"from":"failed","to":"editing","event":"RETRY","effects":[],"index":4},{"from":"editing","to":"browsing","event":"CANCEL","effects":[{"type":"render-ui","args":[]}],"index":5},{"from":"confirmed","to":"browsing","event":"DONE","effects":[{"type":"navigate","args":[]}],"index":6}],"emittedEvents":["ORDER_SAVED"],"listenedEvents":["PAYMENT_OK"]}
   */
  trait: TraitLevelData;
  /** State execution is currently in. */
  activeState?: string;
  /** `index` of the transition that just fired. */
  activeTransition?: number;
  /** States already passed through, in order. */
  visitedStates?: string[];
  /** Keep the active state in view: when it changes, the diagram scrolls sideways to centre it. @default false */
  followActive?: boolean;
  /** Emits UI:{stateClickEvent} with { stateId } when a state is clicked. */
  stateClickEvent?: EventEmit<{ stateId: string }>;
  /** Emits UI:{transitionClickEvent} with { index, event, from, to } when a transition label is clicked. */
  transitionClickEvent?: EventEmit<{ index: number; event: string; from: string; to: string }>;
  /** Direct transition-click callback, for React hosts (e.g. a canvas node). */
  onTransitionClick?: (transition: { index: number; event: string; from: string; to: string }) => void;
  /** State picked in an editor (first click). */
  selectedState?: string;
  /** Source of a transition being drawn — the next state click picks its target. */
  pendingSourceState?: string;
  /** Node silhouette. @default 'pill' */
  nodeShape?: 'pill' | 'gear';
  /** Entity field names listed in the header. */
  entityFields?: string[];
  /** Flow direction. @default 'ltr' */
  direction?: 'ltr' | 'rtl';
  /** Show the trait header (name, entity, listens/emits). @default true */
  showHeader?: boolean;
  /** Author explanations shown in a popover on hover: a note per state name, per transition event and per effect type.
   * @example {"states":{"pending":{"title":"Unpaid","body":"Every order starts here."}},"transitions":{"PAY":{"body":"Only fires when the amount is positive."}},"effects":{"persist":{"body":"Saves the order."}}}
   */
  annotations?: AvlAnnotations;
  className?: string;
}

const MONO_CHAR = 7.3;
const BODY_CHAR = 7.6;
const NODE_H = 44;
const PILL_H = 24;
const EFFECT_CHIP = 14;
const EFFECT_GAP = 4;
const MARGIN = 28;
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.25;

type Transition = TraitLevelData['transitions'][number];

/** An effect's code; none when only its type is known (data without arguments). */
function effectText(effect: Transition['effects'][number]): string | undefined {
  return effect.args.length === 0 ? undefined : formatSExpr([effect.type, ...effect.args]);
}

function guardText(t: Transition): string | null {
  return t.guard === undefined || t.guard === null ? null : formatSExpr(t.guard);
}

function pillWidth(t: Transition): number {
  return 20 + (guardText(t) === null ? 0 : 16) + t.event.length * MONO_CHAR + t.effects.length * (EFFECT_CHIP + EFFECT_GAP);
}

function gearDiameter(name: string): number {
  return Math.max(96, Math.round(name.length * BODY_CHAR + 40));
}

function metricsFor(nodeShape: 'pill' | 'gear', direction: 'ltr' | 'rtl'): TraitLayoutMetrics {
  return {
  nodeSize: (name) => nodeShape === 'gear'
    ? { width: gearDiameter(name), height: gearDiameter(name) }
    : { width: Math.max(112, Math.round(name.length * BODY_CHAR + 44)), height: NODE_H },
  labelSize: (t) => ({ width: pillWidth(t), height: PILL_H }),
  nodeSpacing: 40,
  layerSpacing: 88,
  orthogonal: true,
  direction,
  };
}

export const AvlStateMachine: React.FC<AvlStateMachineProps> = ({
  trait,
  activeState,
  activeTransition,
  visitedStates,
  followActive = false,
  stateClickEvent,
  transitionClickEvent,
  onTransitionClick,
  selectedState,
  pendingSourceState,
  nodeShape = 'pill',
  entityFields,
  direction = 'ltr',
  showHeader = true,
  annotations,
  className,
  ...rest
}) => {
  const passthrough = domPassthrough(rest);
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const clickable = transitionClickEvent !== undefined || onTransitionClick !== undefined;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [layout, setLayout] = useState<ElkLayout | null>(null);
  const [layoutFailed, setLayoutFailed] = useState(false);
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const hostWidth = useContainerWidth(hostRef);
  const traitKey = useMemo(() => JSON.stringify(trait), [trait]);

  useEffect(() => {
    if (trait.states.length === 0) return;
    let live = true;
    setLayoutFailed(false);
    computeTraitLayout(trait, metricsFor(nodeShape, direction))
      .then((l) => { if (live) setLayout(l); })
      .catch((error) => {
        log.error('layout-failed', { trait: trait.name, error: error instanceof Error ? error : String(error) });
        if (live) setLayoutFailed(true);
      });
    return () => { live = false; };
    // trait is captured by its serialized key.
  }, [traitKey, nodeShape, direction, layoutAttempt]);

  useEffect(() => {
    const host = hostRef.current;
    if (!followActive || layout === null || host === null || activeState === undefined) return;
    const node = [...host.querySelectorAll<Element>('[data-testid="avl-sm-state"]')].find((n) => n.getAttribute('data-state') === activeState);
    if (node === undefined) return;
    const hostBox = host.getBoundingClientRect();
    const nodeBox = node.getBoundingClientRect();
    const left = host.scrollLeft + (nodeBox.left + nodeBox.width / 2) - (hostBox.left + hostBox.width / 2);
    host.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [followActive, layout, activeState, reduceMotion]);

  const visitOrder = useMemo(() => new Map((visitedStates ?? []).map((s, i) => [s, i + 1])), [visitedStates]);
  const nextFromActive = useMemo(
    () => new Set(trait.transitions.filter((tr) => activeState !== undefined && tr.from === activeState).map((tr) => tr.index)),
    [trait.transitions, activeState],
  );

  const header = showHeader ? (
    <Box className="flex flex-wrap items-baseline justify-between gap-2 pb-3">
      <Box className="flex items-baseline gap-2">
        <Typography variant="body" weight="semibold">{trait.name}</Typography>
        <Typography variant="caption" color="muted">
          {t('avl.onEntity', { entity: trait.linkedEntity })} · {t('avl.stateCount', { count: trait.states.length })} · {t('avl.transitionCount', { count: trait.transitions.length })}
        </Typography>
      </Box>
      <Box className="flex flex-wrap gap-2">
        {entityFields && entityFields.length > 0 ? (
          <Box as="span" data-testid="avl-sm-fields" style={{ fontFamily: AVL_FONT.mono, fontSize: 12, lineHeight: '20px', color: AVL_INK.quiet }}>
            {trait.linkedEntity} {'{ '}{entityFields.join(', ')}{' }'}
          </Box>
        ) : null}
        {trait.listenedEvents.map((ev) => (
          <Rail key={`in-${ev}`} kind={t('avl.listensRail')} event={ev} />
        ))}
        {trait.emittedEvents.map((ev) => (
          <Rail key={`out-${ev}`} kind={t('avl.emitsRail')} event={ev} />
        ))}
      </Box>
    </Box>
  ) : null;

  if (trait.states.length === 0) {
    return (
      <Box data-testid="avl-state-machine" className={className} style={{ width: '100%' }} {...passthrough}>
        {header}
        <Box data-testid="avl-state-machine-empty" className="rounded-md border border-dashed p-6 text-center" style={{ borderColor: AVL_INK.line }}>
          <Typography variant="caption" color="muted">{t('avl.noStateMachine')}</Typography>
        </Box>
      </Box>
    );
  }

  const w = layout ? layout.width + 2 * MARGIN : 0;
  const h = layout ? layout.height + 2 * MARGIN : 0;
  const fit = layout && hostWidth ? hostWidth / w : 1;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit));

  return (
    <Box data-testid="avl-state-machine" className={className} style={{ width: '100%' }} {...passthrough}>
      {header}
      <Box ref={hostRef} className="overflow-x-auto" style={{ width: '100%' }}>
        {layout ? (
          <Box className="relative mx-auto" style={{ width: w * scale, height: h * scale }}>
            <Box className="absolute left-0 top-0" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
              <svg width={w} height={h} className="absolute left-0 top-0 overflow-visible" aria-hidden="true">
                <defs>
                  <marker id={`avl-sm-head-${trait.name}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0 L10 5 L0 10z" fill={AVL_INK.quiet} fillOpacity={0.8} />
                  </marker>
                  <marker id={`avl-sm-head-hot-${trait.name}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0 0 L10 5 L0 10z" fill={AVL_INK.focus} />
                  </marker>
                </defs>
                <g transform={`translate(${MARGIN},${MARGIN})`}>
                  {layout.nodes.filter((n) => n.isInitial).map((n) => {
                    const cy = n.y + n.height / 2;
                    const rtl = direction === 'rtl';
                    const dot = rtl ? n.x + n.width + 18 : n.x - 18;
                    const d = rtl ? `M ${n.x + n.width + 13} ${cy} H ${n.x + n.width + 1}` : `M ${n.x - 13} ${cy} H ${n.x - 1}`;
                    return (
                      <g key={`init-${n.id}`}>
                        <circle cx={dot} cy={cy} r={5} fill={AVL_INK.text} />
                        <path d={d} stroke={AVL_INK.quiet} strokeWidth={AVL_STROKE.wire} markerEnd={`url(#avl-sm-head-${trait.name})`} />
                      </g>
                    );
                  })}
                  {layout.edges.map((e) => {
                    const fired = e.index === activeTransition;
                    return (
                      <path
                        key={e.id}
                        data-testid="avl-sm-wire"
                        data-event={e.event}
                        data-fired={fired ? 'true' : 'false'}
                        d={roundedEdgePath(e.points, 10)}
                        fill="none"
                        stroke={fired ? AVL_INK.focus : AVL_INK.quiet}
                        strokeOpacity={fired ? 1 : 0.55}
                        strokeWidth={fired ? AVL_STROKE.active : AVL_STROKE.wire}
                        strokeDasharray={fired ? '8 6' : e.isBackward || e.isSelf ? '5 4' : undefined}
                        markerEnd={`url(#avl-sm-head${fired ? '-hot' : ''}-${trait.name})`}
                      >
                        {fired && !reduceMotion ? <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.8s" repeatCount="indefinite" /> : null}
                      </path>
                    );
                  })}
                  {layout.nodes.filter((n) => n.id === activeState).map((n) => (
                    <rect key={`ring-${n.id}`} x={n.x - 5} y={n.y - 5} width={n.width + 10} height={n.height + 10} rx={12}
                      fill="none" stroke={AVL_INK.focus} strokeWidth={4} strokeOpacity={0.22}>
                      {!reduceMotion ? <animate attributeName="stroke-opacity" values="0.28;0.06;0.28" dur="1.6s" repeatCount="indefinite" /> : null}
                    </rect>
                  ))}
                </g>
              </svg>

              {layout.edges.map((e) => {
                const tr = trait.transitions.find((x) => x.index === e.index);
                if (!tr) return null;
                const fired = e.index === activeTransition;
                const next = !fired && nextFromActive.has(e.index);
                const guard = guardText(tr);
                const pw = pillWidth(tr);
                return (
                  <Box
                    key={`label-${e.id}`}
                    data-testid="avl-sm-label"
                    data-event={tr.event}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    aria-current={fired ? 'true' : undefined}
                    onClick={clickable ? () => {
                      const payload = { index: tr.index, event: tr.event, from: tr.from, to: tr.to };
                      onTransitionClick?.(payload);
                      if (transitionClickEvent) eventBus.emit(`UI:${transitionClickEvent}`, payload);
                    } : undefined}
                    className={`absolute flex flex-col items-center justify-center ${clickable ? 'cursor-pointer' : ''}`}
                    style={{ left: MARGIN + e.labelX, top: MARGIN + e.labelY, width: e.labelW, height: e.labelH }}
                  >
                    <Box
                      className="flex items-center gap-1 rounded-md px-2"
                      style={{
                        height: PILL_H,
                        width: pw,
                        background: AVL_INK.surface,
                        border: `1px ${next ? 'dashed' : 'solid'} ${fired ? AVL_INK.focus : AVL_INK.line}`,
                        fontFamily: AVL_FONT.mono,
                        fontSize: 12,
                        color: fired ? AVL_INK.focus : AVL_INK.text,
                        fontWeight: fired ? 600 : 400,
                      }}
                    >
                      {guard !== null ? (
                        <AvlExplain lines={[t('avl.guard'), t('avl.guardCaption')]} code={guard}>
                          <Box as="span" role="img" tabIndex={0} aria-label={`${t('avl.guard')}: ${guard}`} data-testid="avl-guard-glyph" className="inline-flex shrink-0 cursor-help rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
                              <path d="M6 1 L11 6 L6 11 L1 6z" fill={AVL_INK.surface} stroke={fired ? AVL_INK.focus : AVL_INK.quiet} strokeWidth={1.2} />
                            </svg>
                          </Box>
                        </AvlExplain>
                      ) : null}
                      {annotations?.transitions?.[tr.event] ? (
                        <AvlExplain lines={[tr.event]} code={guard ?? undefined} note={annotations.transitions[tr.event]}>
                          <Box as="span" tabIndex={0} data-explain={`transition:${tr.event}`} className="whitespace-nowrap underline decoration-dotted underline-offset-2 cursor-help">{tr.event}</Box>
                        </AvlExplain>
                      ) : (
                        <Box as="span" className="whitespace-nowrap">{tr.event}</Box>
                      )}
                      {tr.effects.map((fx, i) => (
                        <AvlEffectChip key={`${fx.type}-${i}`} effectType={fx.type} size={EFFECT_CHIP} note={annotations?.effects?.[fx.type]} code={effectText(fx)} />
                      ))}
                    </Box>
                  </Box>
                );
              })}

              {trait.states.map((s) => {
                const n = layout.nodes.find((x) => x.id === s.name);
                if (!n) return null;
                const active = s.name === activeState;
                const selected = s.name === selectedState;
                const pending = s.name === pendingSourceState;
                const visit = visitOrder.get(s.name);
                const idle = activeState !== undefined && !active && visit === undefined;
                const gear = nodeShape === 'gear';
                const emphasis = active || selected || pending;
                return (
                  <Box
                    key={s.name}
                    data-testid="avl-sm-state"
                    data-state={s.name}
                    data-active={active ? 'true' : 'false'}
                    data-selected={selected ? 'true' : 'false'}
                    data-pending={pending ? 'true' : 'false'}
                    data-shape={nodeShape}
                    role={stateClickEvent ? 'button' : undefined}
                    tabIndex={stateClickEvent ? 0 : undefined}
                    aria-current={active ? 'true' : undefined}
                    aria-pressed={stateClickEvent ? selected : undefined}
                    onClick={stateClickEvent ? () => eventBus.emit(`UI:${stateClickEvent}`, { stateId: s.name }) : undefined}
                    className={`absolute flex items-center justify-center ${gear ? 'rounded-full' : 'rounded-lg'} ${stateClickEvent ? 'cursor-pointer' : ''}`}
                    style={{
                      left: MARGIN + n.x,
                      top: MARGIN + n.y,
                      width: n.width,
                      height: n.height,
                      background: gear ? 'transparent' : AVL_INK.surface,
                      border: gear ? 'none' : `${emphasis ? 2 : 1}px ${pending ? 'dashed' : 'solid'} ${emphasis ? AVL_INK.focus : AVL_INK.line}`,
                      boxShadow: gear
                        ? 'none'
                        : s.isTerminal
                          ? `0 0 0 3px ${AVL_INK.surface}, 0 0 0 4px ${AVL_INK.line}, var(--shadow-sm)`
                          : selected
                            ? `0 0 0 4px ${avlTint(AVL_INK.focus, 18)}, var(--shadow-hover)`
                            : active ? 'var(--shadow-hover)' : 'var(--shadow-sm)',
                      color: idle ? AVL_INK.quiet : AVL_INK.text,
                      fontFamily: AVL_FONT.body,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      transition: 'border-color var(--duration-normal, 200ms), box-shadow var(--duration-normal, 200ms)',
                    }}
                  >
                    {pending ? <Box as="span" className="sr-only">{t('avl.pendingSourceState')}</Box> : null}
                    {visit !== undefined && !active ? (
                      <Box
                        as="span"
                        data-testid="avl-sm-visit"
                        className="absolute flex items-center justify-center rounded-full"
                        style={{ top: -9, left: -9, width: 18, height: 18, fontSize: 11, fontWeight: 600, background: AVL_INK.wash, color: AVL_INK.quiet, border: `1px solid ${AVL_INK.line}` }}
                      >
                        {visit}
                      </Box>
                    ) : null}
                    {active ? (
                      <Box
                        as="span"
                        className="absolute rounded-full px-1.5"
                        style={{ top: -10, right: 8, fontSize: 11, fontWeight: 600, background: AVL_INK.focus, color: AVL_INK.onFocus, boxShadow: `0 0 0 2px ${avlTint(AVL_INK.focus, 18)}` }}
                      >
                        {t('avl.now')}
                      </Box>
                    ) : null}
                    {gear ? (
                      <svg data-testid="avl-sm-gear" width={n.width} height={n.height} className="absolute left-0 top-0" aria-hidden="true">
                        <path
                          d={gearTeethPath(n.width / 2, n.height / 2, n.width / 2 - 8, n.width / 2 - 1, 12)}
                          fill={AVL_INK.surface}
                          stroke={emphasis ? AVL_INK.focus : AVL_INK.line}
                          strokeWidth={emphasis ? 2 : 1.25}
                          strokeDasharray={pending || s.isTerminal ? '4 3' : undefined}
                        />
                        <circle cx={n.width / 2} cy={n.height / 2} r={n.width / 2 - 14} fill="none" stroke={AVL_INK.line} strokeWidth={1} />
                      </svg>
                    ) : null}
                    {annotations?.states?.[s.name] ? (
                      <AvlExplain lines={[s.name]} note={annotations.states[s.name]}>
                        <Box as="span" tabIndex={0} data-explain={`state:${s.name}`} className="relative underline decoration-dotted underline-offset-2 cursor-help">{s.name}</Box>
                      </AvlExplain>
                    ) : (
                      <Box as="span" className="relative">{s.name}</Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ) : (
          layoutFailed ? (
            <Box role="alert" className="flex flex-col items-center justify-center gap-2 py-10">
              <Typography variant="caption" color="muted">{t('avl.layoutFailed')}</Typography>
              <Button variant="ghost" size="sm" label={t('common.retry')} onClick={() => setLayoutAttempt((n) => n + 1)} />
            </Box>
          ) : (
            <Box className="flex items-center justify-center py-10">
              <Typography variant="caption" color="muted">{t('avl.computingLayout')}</Typography>
            </Box>
          )
        )}
      </Box>
    </Box>
  );
};

const Rail: React.FC<{ kind: string; event: string }> = ({ kind, event }) => (
  <Box
    as="span"
    className="inline-flex items-center gap-1 rounded-full px-2"
    style={{ fontFamily: AVL_FONT.mono, fontSize: 12, lineHeight: '20px', border: `1px solid ${AVL_INK.line}`, background: AVL_INK.wash, color: AVL_INK.quiet }}
  >
    {kind}
    <Box as="span" style={{ color: AVL_INK.text, fontWeight: 600 }}>{event}</Box>
  </Box>
);

AvlStateMachine.displayName = 'AvlStateMachine';
