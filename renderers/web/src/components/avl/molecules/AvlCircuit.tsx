'use client';

/**
 * AvlCircuit — a Lisp S-expression drawn as a circuit and, given a trace,
 * shown executing: values ride the wires, `and`/`or` are switch chains that
 * break where a condition fails, `if` throws a track switch, lambdas run items
 * down a conveyor, effects light rungs of a ladder.
 */

import React, { useMemo, useRef } from 'react';
import { formatSExpr, type EvalTrace, type RuntimeValue, type SExpr } from '@almadar/core';
import { getStdOperatorMeta } from '@almadar/std/registry';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';
import { useContainerWidth } from '../../../hooks/useContainerWidth';
import { useMediaQuery } from '../../../core';
import { AvlEffect } from '../atoms/AvlEffect';
import { roundedEdgePath } from '../../../lib/avl-elk-layout';
import { AVL_FONT, AVL_INK, OPERATOR_CATEGORY_COLORS, avlBlend, avlTint, effectZoneOf } from '../../../lib/avl-theme';
import {
  activeStack,
  buildCircuit,
  circuitState,
  portY,
  type CircuitNode,
  type NodeState,
} from '../../../lib/avl-circuit-layout';

export interface AvlCircuitProps {
  /** The Lisp code to draw (an `.orb` S-expression). */
  expr: SExpr;
  /** Evaluation trace of `expr` (see `evaluateTraced`). */
  trace?: EvalTrace;
  /** Last trace step to show. Defaults to the end of the trace. */
  cursor?: number;
  /** Caption over the board (e.g. "guard of SAVE"). */
  title?: string;
  /** Show the code line under the title. @default true */
  showCode?: boolean;
  className?: string;
}

const MIN_SCALE = 0.85;
const MAX_SCALE = 1.2;
const IDLE: NodeState = { status: 'idle', results: [] };

function truthy(v: RuntimeValue | undefined): boolean {
  return v !== undefined && v !== null && v !== false && v !== 0 && v !== '';
}

function fmt(v: RuntimeValue | undefined): string {
  if (v === undefined) return '';
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? JSON.stringify(v) : String(v);
  if (Array.isArray(v)) {
    return v.length <= 4 && v.every((x) => x === null || typeof x !== 'object') ? `[${v.map(fmt).join(' ')}]` : `[${v.length}]`;
  }
  const keys = Object.keys(v);
  return keys.length <= 3 ? `{${keys.join(', ')}}` : `{${keys.length}}`;
}

function opColor(op: string): string {
  const meta = getStdOperatorMeta(op);
  return meta ? OPERATOR_CATEGORY_COLORS[meta.category] : AVL_INK.quiet;
}

export const AvlCircuit: React.FC<AvlCircuitProps> = ({ expr, trace, cursor, title, showCode = true, className }) => {
  const { t } = useTranslate();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hostRef = useRef<HTMLDivElement>(null);
  const hostWidth = useContainerWidth(hostRef);
  const circuit = useMemo(() => buildCircuit(expr), [expr]);
  const at = trace ? Math.min(cursor ?? trace.length - 1, trace.length - 1) : -1;
  const states = useMemo(() => (trace ? circuitState(trace, at) : new Map<string, NodeState>()), [trace, at]);
  const stack = useMemo(() => (trace ? activeStack(trace, at) : []), [trace, at]);
  const nodes = useMemo(() => {
    const out = new Map<string, CircuitNode>();
    const walk = (n: CircuitNode) => { out.set(n.key, n); n.children.forEach(walk); };
    walk(circuit.root);
    return out;
  }, [circuit]);
  const parents = useMemo(() => {
    const out = new Map<string, CircuitNode>();
    const walk = (n: CircuitNode) => { n.children.forEach((c) => { out.set(c.key, n); walk(c); }); };
    walk(circuit.root);
    return out;
  }, [circuit]);
  // "Never ran" only means something under a short-circuiting parent; elsewhere an
  // unevaluated argument is an operand read as a name (set's target, persist's mode).
  const stateOf = (n: CircuitNode): NodeState => {
    const s = states.get(n.key) ?? IDLE;
    if (s.status !== 'skipped') return s;
    const form = parents.get(n.key)?.form;
    return form === 'series' || form === 'parallel' || form === 'branch' ? s : IDLE;
  };
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, hostWidth ? hostWidth / (circuit.w + 120) : 1));
  const W = circuit.w + 120;

  const narration = (() => {
    if (!trace || at < 0) return null;
    const step = trace[at];
    const node = nodes.get(step.path.join('.'));
    const code = node ? formatSExpr(node.expr) : '';
    if (step.kind === 'enter') return t('avl.circuit.evaluating', { code });
    if (step.kind === 'skip') return t('avl.circuit.skipped', { code });
    if (step.kind === 'iter') return t('avl.circuit.nextItem', { code });
    if (step.error !== undefined) return t('avl.circuit.failed', { code, error: step.error });
    return t('avl.circuit.returned', { code, value: fmt(step.value) });
  })();

  const wire = (parent: CircuitNode, child: CircuitNode, i: number): React.ReactNode => {
    const s = stateOf(child);
    const x1 = child.x + child.w;
    const y1 = child.y + child.h / 2;
    const x2 = parent.x;
    const y2 = portY(parent, i);
    const xm = x2 - 24;
    const d = roundedEdgePath([{ x: x1, y: y1 }, { x: xm, y: y1 }, { x: xm, y: y2 }, { x: x2, y: y2 }], 8);
    const live = s.status === 'done';
    const running = s.status === 'active';
    const label = parent.wireLabels[i];
    return (
      <g key={`w-${child.key}`}>
        <path d={d} fill="none"
          stroke={s.status === 'error' ? AVL_INK.fail : live || running ? AVL_INK.focus : AVL_INK.quiet}
          strokeOpacity={s.status === 'skipped' ? 0.25 : live || running ? 1 : 0.5}
          strokeWidth={live ? 2 : 1.5}
          strokeDasharray={s.status === 'skipped' ? '3 4' : running ? '8 6' : undefined}>
          {running && !reduceMotion ? <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.8s" repeatCount="indefinite" /> : null}
        </path>
        {label ? <text x={xm + 4} y={y2 - 6} fontFamily={AVL_FONT.mono} fontSize={12} fill={AVL_INK.quiet}>{label}</text> : null}
        {live && s.value !== undefined ? valueChip((x1 + xm) / 2, y1, s.value, true) : null}
      </g>
    );
  };

  const valueChip = (x: number, y: number, v: RuntimeValue, centered = false): React.ReactNode => {
    const text = fmt(v);
    const w = Math.max(28, text.length * 7.4 + 14);
    if (centered) x -= w / 2;
    const isBool = typeof v === 'boolean';
    const tone = isBool ? (v ? AVL_INK.pass : AVL_INK.fail) : AVL_INK.focus;
    return (
      <g>
        <title>{JSON.stringify(v)}</title>
        <rect x={x} y={y - 22} width={w} height={18} rx={9} fill={avlTint(tone, 16)} stroke={tone} strokeWidth={1} />
        <text data-testid="avl-circuit-value" x={x + w / 2} y={y - 13} textAnchor="middle" dominantBaseline="central"
          fontFamily={AVL_FONT.mono} fontSize={12} fontWeight={600} fill={AVL_INK.text}>{text}</text>
      </g>
    );
  };

  const switchGlyph = (n: CircuitNode, i: number, cx: number, cy: number, vertical: boolean): React.ReactNode => {
    const child = n.children[i];
    const s = stateOf(child);
    const decided = s.status === 'done';
    const closed = decided && truthy(s.value);
    const color = s.status === 'skipped' ? AVL_INK.quiet : decided ? (closed ? AVL_INK.focus : AVL_INK.fail) : AVL_INK.quiet;
    const a = vertical ? { x: cx, y: cy - 13 } : { x: cx - 14, y: cy };
    const b = vertical ? { x: cx, y: cy + 13 } : { x: cx + 14, y: cy };
    const lever = closed || !decided ? b : vertical ? { x: cx + 16, y: cy + 6 } : { x: cx + 8, y: cy - 14 };
    return (
      <g key={`sw-${child.key}`} opacity={s.status === 'skipped' ? 0.35 : 1}
        {...(decided && !closed ? { 'data-testid': 'avl-circuit-open-switch', 'data-key': child.key } : {})}>
        <line x1={n.x} y1={portY(n, i)} x2={vertical ? cx - 4 : cx} y2={cy} stroke={AVL_INK.quiet} strokeWidth={1} strokeDasharray="2 3" />
        <circle cx={a.x} cy={a.y} r={2.5} fill={AVL_INK.text} />
        <circle cx={b.x} cy={b.y} r={2.5} fill={decided && !closed ? AVL_INK.quiet : AVL_INK.text} />
        <line x1={a.x} y1={a.y} x2={lever.x} y2={lever.y} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      </g>
    );
  };

  const body = (n: CircuitNode): React.ReactNode => {
    const s = stateOf(n);
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const tint = n.kind === 'call' && n.form !== 'template' ? opColor(n.label) : AVL_INK.quiet;
    const frame = (dashed = false) => (
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.kind === 'binding' || n.kind === 'literal' ? n.h / 2 : 10}
        fill={n.kind === 'call' ? avlBlend(tint, 12, AVL_INK.surface) : n.kind === 'literal' ? AVL_INK.wash : AVL_INK.surface}
        stroke={s.status === 'error' ? AVL_INK.fail : s.status === 'active' ? AVL_INK.focus : n.kind === 'call' ? avlBlend(tint, 55, AVL_INK.line) : AVL_INK.line}
        strokeWidth={s.status === 'active' ? 2 : 1}
        strokeDasharray={dashed || n.form === 'unknown' ? '5 4' : undefined} />
    );
    const caption = (text: string, big = false) => (
      <text x={n.form === 'series' || n.form === 'parallel' || n.form === 'conveyor' || n.form === 'ladder' ? n.x + 10 : cx}
        y={n.form === 'series' || n.form === 'parallel' || n.form === 'conveyor' || n.form === 'ladder' ? n.y + 14 : cy}
        textAnchor={n.form === 'series' || n.form === 'parallel' || n.form === 'conveyor' || n.form === 'ladder' ? 'start' : 'middle'}
        dominantBaseline="central" fontFamily={AVL_FONT.mono} fontSize={big ? 18 : 12}
        fontWeight={big ? 600 : 500} fill={n.kind === 'literal' ? AVL_INK.quiet : AVL_INK.text}>{text}</text>
    );

    if (n.kind !== 'call') return <>{frame()}{caption(n.label)}</>;
    switch (n.form) {
      case 'series': {
        const rx = n.x + n.w - 34;
        const ys = n.children.map((_, i) => portY(n, i));
        let lit = true;
        const segs: React.ReactNode[] = [];
        let prev = n.y + 8;
        n.children.forEach((c, i) => {
          const cs = stateOf(c);
          segs.push(<line key={`r${i}`} x1={rx} y1={prev} x2={rx} y2={ys[i] - 13} stroke={lit ? AVL_INK.focus : AVL_INK.quiet} strokeOpacity={lit ? 1 : 0.4} strokeWidth={2} />);
          lit = lit && cs.status === 'done' && truthy(cs.value);
          prev = ys[i] + 13;
        });
        segs.push(<line key="rend" x1={rx} y1={prev} x2={rx} y2={cy} stroke={lit ? AVL_INK.focus : AVL_INK.quiet} strokeOpacity={lit ? 1 : 0.4} strokeWidth={2} />);
        return <>{frame()}{caption(n.label)}{segs}{n.children.map((_, i) => switchGlyph(n, i, rx, ys[i], true))}</>;
      }
      case 'parallel': {
        const l = n.x + 18;
        const r = n.x + n.w - 18;
        return (
          <>
            {frame()}{caption(n.label)}
            <line x1={l} y1={portY(n, 0) - 10} x2={l} y2={portY(n, n.children.length - 1) + 10} stroke={AVL_INK.quiet} strokeWidth={2} />
            <line x1={r} y1={portY(n, 0) - 10} x2={r} y2={portY(n, n.children.length - 1) + 10} stroke={AVL_INK.quiet} strokeWidth={2} />
            {n.children.map((c, i) => {
              const cs = stateOf(c);
              const on = cs.status === 'done' && truthy(cs.value);
              const py = portY(n, i);
              return (
                <g key={`b${i}`}>
                  <line x1={l} y1={py} x2={(l + r) / 2 - 12} y2={py} stroke={on ? AVL_INK.focus : AVL_INK.quiet} strokeWidth={1.5} />
                  <line x1={(l + r) / 2 + 12} y1={py} x2={r} y2={py} stroke={on ? AVL_INK.focus : AVL_INK.quiet} strokeWidth={1.5} />
                  {switchGlyph(n, i, (l + r) / 2, py, false)}
                </g>
              );
            })}
          </>
        );
      }
      case 'branch': {
        const cond = stateOf(n.children[0]);
        const takenIndex = cond.status === 'done' ? (truthy(cond.value) ? 1 : 2) : -1;
        return (
          <>
            {frame()}
            {n.children.slice(1).map((c, j) => {
              const i = j + 1;
              const on = i === takenIndex;
              return <path key={`t${i}`} d={`M ${n.x} ${portY(n, i)} C ${cx} ${portY(n, i)}, ${cx} ${cy}, ${n.x + n.w} ${cy}`} fill="none"
                stroke={on ? AVL_INK.focus : AVL_INK.quiet} strokeOpacity={on ? 1 : 0.35} strokeWidth={on ? 2.5 : 1.5} />;
            })}
            <line x1={n.x} y1={portY(n, 0)} x2={cx} y2={cy} stroke={AVL_INK.quiet} strokeWidth={1} strokeDasharray="2 3" />
            <text x={n.x + 8} y={n.y + 12} fontFamily={AVL_FONT.mono} fontSize={12} fill={AVL_INK.text}>{n.label}</text>
          </>
        );
      }
      case 'conveyor': {
        const collection = stateOf(n.children[0]);
        const items = Array.isArray(collection.value) ? collection.value : [];
        const lambda = n.children[1];
        const bodyNode = lambda?.children[lambda.children.length - 1];
        const bodyState = bodyNode ? stateOf(bodyNode) : IDLE;
        const results = bodyState.results;
        const beltY = n.y + n.h - 26;
        const step = items.length ? (n.w - 24) / items.length : 0;
        return (
          <>
            {frame()}{caption(n.label)}
            <rect x={n.x + 8} y={beltY - 12} width={n.w - 16} height={24} rx={12} fill={AVL_INK.wash} stroke={AVL_INK.line} />
            {items.map((item, i) => {
              const done = i < results.length;
              const current = bodyState.status === 'active' && i === results.length;
              const result = done ? results[i] : undefined;
              const kept = typeof result === 'boolean' ? result : true;
              const x = n.x + 12 + i * step;
              return (
                <g key={`it${i}`} data-testid="avl-circuit-item" data-result={done ? String(result) : 'pending'}>
                  <title>{JSON.stringify(item)}</title>
                  <rect x={x} y={beltY - 9} width={step - 6} height={18} rx={9}
                    fill={done ? avlTint(kept ? AVL_INK.pass : AVL_INK.fail, 16) : AVL_INK.surface}
                    stroke={current ? AVL_INK.focus : done ? (kept ? AVL_INK.pass : AVL_INK.fail) : AVL_INK.line}
                    strokeWidth={current ? 2 : 1} opacity={done && !kept ? 0.55 : 1} />
                  <text x={x + (step - 6) / 2} y={beltY} textAnchor="middle" dominantBaseline="central" fontFamily={AVL_FONT.mono} fontSize={12}
                    fill={AVL_INK.text} textDecoration={done && !kept ? 'line-through' : undefined}>
                    {`#${i + 1}`}{done ? (typeof result === 'boolean' ? (kept ? ' ✓' : ' ✕') : ` ${fmt(result)}`) : ''}
                  </text>
                </g>
              );
            })}
          </>
        );
      }
      case 'ladder': {
        const rl = n.x + 14;
        return (
          <>
            {frame()}{caption(n.label)}
            <line x1={rl} y1={n.y + 22} x2={rl} y2={n.y + n.h - 6} stroke={AVL_INK.focus} strokeWidth={2} />
            {n.children.map((c, i) => {
              const cs = stateOf(c);
              const color = cs.status === 'done' ? AVL_INK.pass : cs.status === 'active' ? AVL_INK.focus : cs.status === 'error' ? AVL_INK.fail : AVL_INK.quiet;
              return <line key={`r${i}`} x1={rl} y1={portY(n, i)} x2={n.x + n.w - 10} y2={portY(n, i)} stroke={color} strokeWidth={cs.status === 'idle' ? 1 : 2} />;
            })}
          </>
        );
      }
      case 'actuator': {
        const zone = effectZoneOf(n.label);
        return (
          <>
            {frame()}
            <svg x={n.x + 6} y={cy - 9} width={18} height={18} viewBox="-9 -9 18 18" overflow="visible">
              <AvlEffect effectType={n.label} size={7} color={s.status === 'done' ? AVL_INK.pass : AVL_INK.quiet} />
            </svg>
            <text x={n.x + 28} y={cy} dominantBaseline="central" fontFamily={AVL_FONT.mono} fontSize={12} fontWeight={600} fill={AVL_INK.text}>{n.label}</text>
            {s.status === 'done' && zone ? (
              <text data-testid="avl-circuit-zone" x={n.x + n.w - 8} y={n.y + n.h + 14} textAnchor="end" fontFamily={AVL_FONT.mono} fontSize={12} fill={AVL_INK.pass}>→ {t(`avl.circuit.zone.${zone}`)}</text>
            ) : null}
          </>
        );
      }
      case 'invert':
        return (
          <>
            <path d={`M ${n.x + 8} ${n.y + 6} L ${n.x + n.w - 14} ${cy} L ${n.x + 8} ${n.y + n.h - 6} Z`} fill={AVL_INK.surface} stroke={AVL_INK.line} />
            <circle cx={n.x + n.w - 9} cy={cy} r={4} fill={AVL_INK.surface} stroke={AVL_INK.line} />
          </>
        );
      case 'template':
        return <>{frame(true)}{caption(n.label)}</>;
      default:
        return <>{frame()}{caption(n.form === 'unknown' ? `${n.label} ?` : n.label, n.label.length <= 2)}</>;
    }
  };

  const drawn: React.ReactNode[] = [];
  const walk = (n: CircuitNode) => {
    n.children.forEach((c, i) => { walk(c); drawn.push(wire(n, c, i)); });
    const s = stateOf(n);
    drawn.push(
      <g key={`n-${n.key}`} data-testid="avl-circuit-node" data-key={n.key} data-kind={n.kind} data-form={n.form ?? ''} data-status={s.status}
        opacity={s.status === 'skipped' ? 0.35 : 1}>
        {s.status === 'active' ? (
          <rect x={n.x - 4} y={n.y - 4} width={n.w + 8} height={n.h + 8} rx={14} fill="none" stroke={AVL_INK.focus} strokeOpacity={0.22} strokeWidth={4}>
            {!reduceMotion ? <animate attributeName="stroke-opacity" values="0.28;0.06;0.28" dur="1.6s" repeatCount="indefinite" /> : null}
          </rect>
        ) : null}
        {body(n)}
      </g>,
    );
  };
  walk(circuit.root);
  const root = circuit.root;
  const rootState = stateOf(root);
  const outY = root.y + root.h / 2;

  return (
    <Box className={className} style={{ width: '100%' }}>
      {title || showCode ? (
        <Box className="pb-2">
          {title ? <Typography variant="body" weight="semibold">{title}</Typography> : null}
          {showCode ? (
            <Box as="code" data-testid="avl-circuit-code" style={{ display: 'block', fontFamily: AVL_FONT.mono, fontSize: 13, color: AVL_INK.quiet, whiteSpace: 'pre-wrap' }}>
              {formatSExpr(expr)}
            </Box>
          ) : null}
        </Box>
      ) : null}
      <Box ref={hostRef} className="overflow-x-auto" style={{ width: '100%' }}>
        <Box className="relative mx-auto" style={{ width: W * scale, height: circuit.h * scale }}>
          <svg width={W * scale} height={circuit.h * scale} viewBox={`0 0 ${W} ${circuit.h}`} role="img" aria-label={formatSExpr(expr)}>
            {drawn}
            <path d={`M ${root.x + root.w} ${outY} H ${root.x + root.w + 38}`} stroke={rootState.status === 'done' ? AVL_INK.focus : AVL_INK.quiet} strokeWidth={2} />
            {rootState.status === 'done' && typeof rootState.value === 'boolean' ? (
              <circle cx={root.x + root.w + 48} cy={outY} r={8} fill={rootState.value ? AVL_INK.pass : AVL_INK.fail} />
            ) : null}
            {rootState.status === 'done' && rootState.value !== undefined ? valueChip(root.x + root.w + 62, outY + 10, rootState.value) : null}
          </svg>
        </Box>
      </Box>
      {narration !== null ? (
        <Box className="pt-2">
          <Box data-testid="avl-circuit-narration" style={{ fontSize: 13, color: AVL_INK.quiet }}>
            <Box as="span" style={{ color: AVL_INK.text, fontWeight: 600 }}>{t('avl.circuit.step', { n: at + 1, total: trace?.length ?? 0 })}</Box>
            {' — '}{narration}
          </Box>
          {stack.length > 0 ? (
            <Box className="flex flex-wrap items-center gap-1 pt-1" style={{ fontFamily: AVL_FONT.mono, fontSize: 12, color: AVL_INK.quiet }}>
              {t('avl.circuit.stack')}
              {stack.map((k, i) => (
                <Box as="span" key={k} data-testid="avl-circuit-stack-frame" className="rounded px-1.5"
                  style={{ border: `1px solid ${i === stack.length - 1 ? AVL_INK.focus : AVL_INK.line}`, color: i === stack.length - 1 ? AVL_INK.focus : AVL_INK.quiet, background: AVL_INK.wash }}>
                  {nodes.get(k)?.label ?? k}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};

AvlCircuit.displayName = 'AvlCircuit';
