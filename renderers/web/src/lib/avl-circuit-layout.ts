/**
 * AVL circuit layout — an S-expression drawn as a circuit that reads left →
 * right: sources and constants on the left, each call a component whose inputs
 * are its arguments, the root's output on the right. Node paths match
 * `evaluateTraced`'s, so a trace step addresses a drawn node directly.
 */

import { isBinding, type EvalTrace, type RuntimeValue, type SExpr, type SExprPath } from '@almadar/core';
import { operatorVisualForm, type OperatorVisualForm } from '@almadar/std/registry';

export type CircuitForm = OperatorVisualForm | 'unknown';

export interface CircuitNode {
  key: string;
  path: SExprPath;
  kind: 'call' | 'binding' | 'literal' | 'object' | 'array';
  /** Operator for calls, the object key / index label otherwise. */
  label: string;
  form: CircuitForm | null;
  expr: SExpr;
  children: CircuitNode[];
  /** Name shown on the wire into a scope (`let` binding names). */
  wireLabels: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  bandTop: number;
  bandBottom: number;
}

export interface Circuit {
  root: CircuitNode;
  w: number;
  h: number;
}

const MONO = 7.4;
const ROW = 40;
const GAP_X = 112;
const GAP_Y = 16;
const PAD = 12;

const keyOf = (path: SExprPath): string => path.join('.');

function leafLabel(expr: SExpr): string {
  if (typeof expr === 'string') return isBinding(expr) ? expr : JSON.stringify(expr);
  if (expr === null) return 'null';
  if (typeof expr === 'number' || typeof expr === 'boolean') return String(expr);
  return Array.isArray(expr) ? '[…]' : '{…}';
}

function build(expr: SExpr, path: SExprPath): CircuitNode {
  const base = { key: keyOf(path), path, expr, x: 0, y: 0, w: 0, h: 0, bandTop: 0, bandBottom: 0, wireLabels: [] as string[] };
  if (Array.isArray(expr) && expr.length > 0 && typeof expr[0] === 'string') {
    const op = expr[0];
    const args = expr.slice(1);
    const form: CircuitForm = operatorVisualForm(op) ?? 'unknown';
    if (form === 'scope' && Array.isArray(args[0])) {
      const pairs = args[0];
      const bindings = pairs.map((pair, i) => {
        const value = Array.isArray(pair) ? pair[1] : pair;
        return build(value, [...path, 1, i, 1]);
      });
      const names = pairs.map((pair) => (Array.isArray(pair) && typeof pair[0] === 'string' ? pair[0] : ''));
      const body = args.slice(1).map((a, i) => build(a, [...path, i + 2]));
      return { ...base, kind: 'call', label: op, form, children: [...bindings, ...body], wireLabels: [...names, ...body.map(() => '')] };
    }
    if (form === 'template') {
      const params = args[0];
      const body = args.slice(1).map((a, i) => build(a, [...path, i + 2]));
      const paramText = Array.isArray(params) ? params.join(' ') : typeof params === 'string' ? params : '';
      return { ...base, kind: 'call', label: `fn [${paramText}]`, form, children: body, wireLabels: body.map(() => '') };
    }
    const children = args.map((a, i) => build(a, [...path, i + 1]));
    return { ...base, kind: 'call', label: op, form, children, wireLabels: children.map(() => '') };
  }
  if (Array.isArray(expr)) {
    const children = expr.map((a, i) => build(a, [...path, i]));
    return { ...base, kind: 'array', label: '[ ]', form: null, children, wireLabels: children.map((_, i) => String(i)) };
  }
  if (expr !== null && typeof expr === 'object') {
    const entries = Object.entries(expr);
    const children = entries.map(([k, v]) => build(v, [...path, k]));
    return { ...base, kind: 'object', label: '{ }', form: null, children, wireLabels: entries.map(([k]) => k) };
  }
  return { ...base, kind: isBinding(expr) ? 'binding' : 'literal', label: leafLabel(expr), form: null, children: [] };
}

function size(n: CircuitNode): void {
  n.children.forEach(size);
  const ports = Math.max(1, n.children.length);
  if (n.kind === 'binding' || n.kind === 'literal') {
    n.w = Math.max(40, Math.round(n.label.length * MONO + 26));
    n.h = 28;
    return;
  }
  const labelW = Math.round(n.label.length * MONO + 28);
  switch (n.form) {
    case 'series':
    case 'parallel':
      n.w = Math.max(labelW, 120);
      n.h = Math.max(ROW + 16, ports * 40 + 26);
      return;
    case 'conveyor':
      n.w = Math.max(labelW, 200);
      n.h = Math.max(64, ports * 30 + 14);
      return;
    case 'ladder':
      n.w = Math.max(labelW, 80);
      n.h = Math.max(ROW, ports * 30 + 14);
      return;
    case 'actuator':
      n.w = Math.max(labelW + 22, 96);
      n.h = Math.max(ROW, ports * 26 + 12);
      return;
    default:
      n.w = Math.max(labelW, 56);
      n.h = Math.max(ROW, ports * 26 + 12);
  }
}

/** Place a subtree whose band starts at `top`; returns the band height. `right` is the node's right edge. */
function place(n: CircuitNode, right: number, top: number): number {
  n.x = right - n.w;
  if (n.children.length === 0) {
    n.bandTop = top;
    n.bandBottom = top + n.h;
    n.y = top;
    return n.h;
  }
  let cursor = top;
  const childRight = n.x - GAP_X;
  for (const child of n.children) {
    const band = place(child, childRight, cursor);
    cursor += band + GAP_Y;
  }
  const childrenBottom = cursor - GAP_Y;
  const span = childrenBottom - top;
  const band = Math.max(span, n.h);
  n.bandTop = top;
  n.bandBottom = top + band;
  n.y = top + (band - n.h) / 2;
  return band;
}

function subtreeWidth(n: CircuitNode): number {
  return n.w + (n.children.length ? GAP_X + Math.max(...n.children.map(subtreeWidth)) : 0);
}

function shift(n: CircuitNode, dx: number, dy: number): void {
  n.x += dx;
  n.y += dy;
  n.bandTop += dy;
  n.bandBottom += dy;
  n.children.forEach((c) => shift(c, dx, dy));
}

export function buildCircuit(expr: SExpr): Circuit {
  const root = build(expr, []);
  size(root);
  const width = subtreeWidth(root);
  const height = place(root, width, 0);
  shift(root, PAD, PAD);
  return { root, w: width + 2 * PAD, h: height + 2 * PAD };
}

/** Input port y of child `i` on node `n` (ports spread evenly down the node's left edge). */
export function portY(n: CircuitNode, i: number): number {
  const count = Math.max(1, n.children.length);
  return n.y + (n.h * (i + 1)) / (count + 1);
}

export type NodeStatus = 'idle' | 'active' | 'done' | 'error' | 'skipped';

export interface NodeState {
  status: NodeStatus;
  value?: RuntimeValue;
  error?: string;
  /** Exit values in order — one per lambda iteration. */
  results: RuntimeValue[];
}

/** Each touched node's state after applying trace steps 0..cursor (inclusive). */
export function circuitState(trace: EvalTrace, cursor: number): Map<string, NodeState> {
  const out = new Map<string, NodeState>();
  const get = (k: string): NodeState => {
    let s = out.get(k);
    if (!s) {
      s = { status: 'idle', results: [] };
      out.set(k, s);
    }
    return s;
  };
  for (let i = 0; i <= cursor && i < trace.length; i++) {
    const step = trace[i];
    const s = get(keyOf(step.path));
    if (step.kind === 'enter') s.status = 'active';
    else if (step.kind === 'skip') s.status = 'skipped';
    else if (step.kind === 'exit') {
      if (step.error !== undefined) {
        s.status = 'error';
        s.error = step.error;
      } else {
        s.status = 'done';
        s.value = step.value;
        s.results.push(step.value ?? null);
      }
    }
  }
  return out;
}

/** Keys of the nodes currently running, outermost first (the evaluation stack). */
export function activeStack(trace: EvalTrace, cursor: number): string[] {
  const stack: string[] = [];
  for (let i = 0; i <= cursor && i < trace.length; i++) {
    const step = trace[i];
    const k = keyOf(step.path);
    if (step.kind === 'enter') stack.push(k);
    else if (step.kind === 'exit') {
      const at = stack.lastIndexOf(k);
      if (at >= 0) stack.splice(at, 1);
    }
  }
  return stack;
}
