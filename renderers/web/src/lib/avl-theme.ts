/**
 * AVL theme roles — every AVL color is a theme token or a `color-mix` of one,
 * so a diagram repaints with the active `data-theme`. Structure stays neutral;
 * saturated color is reserved for meaning (the focused/active element).
 */

import type { EffectOperator, EffectOperatorFamily } from '@almadar/core';
import type { OperatorCategory } from '@almadar/std';
import { THEME_SERIES } from './theme-color';

export function avlTint(token: string, percent: number): string {
  return `color-mix(in srgb, ${token} ${percent}%, transparent)`;
}

export function avlBlend(token: string, percent: number, other: string): string {
  return `color-mix(in srgb, ${token} ${percent}%, ${other})`;
}

export const AVL_INK = {
  text: 'var(--color-foreground)',
  quiet: 'var(--color-muted-foreground)',
  line: 'var(--color-border)',
  surface: 'var(--color-card)',
  wash: 'var(--color-muted)',
  canvas: 'var(--color-background)',
  focus: 'var(--color-primary)',
  onFocus: 'var(--color-primary-foreground)',
  pass: 'var(--color-success)',
  fail: 'var(--color-error)',
  caution: 'var(--color-warning)',
} as const;

export const AVL_STROKE = {
  hairline: 1,
  wire: 1.5,
  active: 2.5,
} as const;

export const AVL_FONT = {
  body: 'var(--font-family-body, var(--font-family))',
  mono: 'var(--font-family-mono, monospace)',
} as const;

/** The i-th distinct categorical color: the six semantic series, then darker and lighter blends of them. */
export function avlSeries(i: number): string {
  const base = THEME_SERIES[i % THEME_SERIES.length];
  const band = Math.floor(i / THEME_SERIES.length) % 3;
  if (band === 0) return base;
  return avlBlend(base, 65, band === 1 ? AVL_INK.text : AVL_INK.canvas);
}

// ─── Atom drawing contract ────────────────────────────────────

/** Every AVL atom renders a `<g>` placed inside a parent svg. */
export interface AvlBaseProps {
  x?: number;
  y?: number;
  color?: string;
  opacity?: number;
  className?: string;
}

// ─── States ───────────────────────────────────────────────────

export type StateRole = 'initial' | 'terminal' | 'hub' | 'default';

export const STATE_COLORS: Record<StateRole, { fill: string; border: string }> = {
  initial: { fill: avlTint('var(--color-success)', 12), border: 'var(--color-success)' },
  terminal: { fill: avlTint('var(--color-foreground)', 6), border: 'var(--color-foreground)' },
  hub: { fill: avlTint('var(--color-info)', 12), border: 'var(--color-info)' },
  default: { fill: avlTint('var(--color-muted-foreground)', 8), border: 'var(--color-muted-foreground)' },
};

export function getStateRole(
  isInitial?: boolean,
  isTerminal?: boolean,
  transitionCount?: number,
  maxTransitionCount?: number,
): StateRole {
  if (isInitial) return 'initial';
  if (isTerminal) return 'terminal';
  if (transitionCount != null && maxTransitionCount != null
      && transitionCount === maxTransitionCount && transitionCount >= 3) return 'hub';
  return 'default';
}

export const CONNECTION_COLORS = {
  forward: { color: 'var(--color-muted-foreground)', width: 1.5, dash: 'none' },
  backward: { color: 'var(--color-muted-foreground)', width: 1.5, dash: '5 4' },
  selfLoop: { color: 'var(--color-muted-foreground)', width: 1, dash: '3 2' },
  emitListen: { color: 'var(--color-warning)', width: 1.5, dash: '4 3' },
} as const;

// ─── Effects (keyed on @almadar/core's Effect union) ──────────

export type EffectCategory = 'ui' | 'data' | 'communication' | 'lifecycle' | 'control' | 'async' | 'compute' | 'system';

export const EFFECT_CATEGORY_COLORS: Record<EffectCategory, { color: string; bg: string }> = {
  ui: { color: 'var(--color-accent)', bg: avlTint('var(--color-accent)', 10) },
  data: { color: 'var(--color-info)', bg: avlTint('var(--color-info)', 10) },
  communication: { color: 'var(--color-warning)', bg: avlTint('var(--color-warning)', 10) },
  lifecycle: { color: 'var(--color-success)', bg: avlTint('var(--color-success)', 10) },
  control: { color: 'var(--color-muted-foreground)', bg: avlTint('var(--color-muted-foreground)', 10) },
  async: { color: avlBlend('var(--color-info)', 50, 'var(--color-accent)'), bg: avlTint(avlBlend('var(--color-info)', 50, 'var(--color-accent)'), 10) },
  compute: { color: 'var(--color-primary)', bg: avlTint('var(--color-primary)', 10) },
  system: { color: avlBlend('var(--color-muted-foreground)', 60, 'var(--color-primary)'), bg: avlTint('var(--color-muted-foreground)', 10) },
};

const EFFECT_OPERATOR_CATEGORY: Record<EffectOperator, EffectCategory> = {
  'access-check': 'system',
  'render-ui': 'ui', 'navigate': 'ui', 'navigate-back': 'ui',
  'set': 'data', 'persist': 'data', 'fetch': 'data', 'fetch-stream': 'data',
  'emit': 'communication', 'http': 'communication', 'notify': 'communication', 'send-server': 'communication', 'call-service': 'communication', 'cancel-call': 'communication',
  'spawn': 'lifecycle', 'despawn': 'lifecycle',
  'do': 'control', 'if': 'control', 'when': 'control', 'let': 'control', 'log': 'control',
  'wait': 'async',
  'prob/seed': 'compute', 'prob/condition': 'compute',
  'workspace/write-orbital': 'system', 'workspace/write-file': 'system', 'workspace/write-schema': 'system',
  'workspace/write-plan': 'system', 'workspace/archive-orbital': 'system',
  'behavior/catalog': 'system', 'behavior/describe': 'system', 'behavior/packages': 'system', 'behavior/source': 'system', 'behavior/resolve': 'system', 'behavior/dependencies': 'system',
  'program/read': 'system', 'program/print': 'system', 'program/eval': 'system', 'program/validate': 'system', 'program/prove': 'system', 'program/os-grants': 'system', 'program/compose': 'system', 'program/step': 'system',
  'program/resolve-rows': 'system', 'program/self': 'system', 'program/tick': 'system', 'program/inputs': 'system', 'program/dispatch': 'system', 'program/live': 'system', 'persist/read-named': 'system',
  'credential-status': 'system', 'credential-forget': 'system', 'random-bytes': 'compute',
  'oauth-authorize': 'system', 'oauth-connection-status': 'system', 'oauth-connection-forget': 'system',
  'credential-list': 'system', 'credential-set': 'system', 'credential-remove': 'system', 'credential-test': 'system', 'credential-mode': 'system', 'credential-rotate': 'system',
};

const EFFECT_FAMILY_CATEGORY: Record<EffectOperatorFamily, EffectCategory> = {
  agent: 'system', os: 'system', browser: 'system', llm: 'system',
  session: 'system', trace: 'control', memory: 'data', kv: 'data', application: 'system', audio: 'ui', auth: 'system',
};

/** Where in the world an effect lands — drawn as the actuator's target. */
export type EffectZone = 'entity' | 'store' | 'bus' | 'screen' | 'route' | 'toast' | 'remote' | 'instances' | 'flow' | 'timer' | 'model' | 'system';

const EFFECT_OPERATOR_ZONE: Record<EffectOperator, EffectZone> = {
  'access-check': 'system',
  'render-ui': 'screen', 'navigate': 'route', 'navigate-back': 'route',
  'set': 'entity',
  'persist': 'store', 'fetch': 'store', 'fetch-stream': 'store',
  'emit': 'bus', 'send-server': 'bus', 'http': 'remote', 'notify': 'toast', 'call-service': 'remote', 'cancel-call': 'remote',
  'spawn': 'instances', 'despawn': 'instances',
  'do': 'flow', 'if': 'flow', 'when': 'flow', 'let': 'flow', 'log': 'flow',
  'wait': 'timer',
  'prob/seed': 'model', 'prob/condition': 'model',
  'workspace/write-orbital': 'system', 'workspace/write-file': 'system', 'workspace/write-schema': 'system',
  'workspace/write-plan': 'system', 'workspace/archive-orbital': 'system',
  'behavior/catalog': 'system', 'behavior/describe': 'system', 'behavior/packages': 'system', 'behavior/source': 'system', 'behavior/resolve': 'system', 'behavior/dependencies': 'system',
  'program/read': 'system', 'program/print': 'system', 'program/eval': 'system', 'program/validate': 'system', 'program/prove': 'system', 'program/os-grants': 'system', 'program/compose': 'system', 'program/step': 'system',
  'program/resolve-rows': 'system', 'program/self': 'system', 'program/tick': 'system', 'program/inputs': 'system', 'program/dispatch': 'system', 'program/live': 'system', 'persist/read-named': 'system',
  'credential-status': 'system', 'credential-forget': 'system', 'random-bytes': 'system',
  'oauth-authorize': 'remote', 'oauth-connection-status': 'remote', 'oauth-connection-forget': 'remote',
  'credential-list': 'system', 'credential-set': 'system', 'credential-remove': 'system', 'credential-test': 'system', 'credential-mode': 'system', 'credential-rotate': 'system',
};

const EFFECT_FAMILY_ZONE: Record<EffectOperatorFamily, EffectZone> = {
  agent: 'system', os: 'system', browser: 'system', llm: 'remote',
  session: 'system', trace: 'flow', memory: 'store', kv: 'store', application: 'system', audio: 'system', auth: 'remote',
};

function isEffectOperator(head: string): head is EffectOperator {
  return head in EFFECT_OPERATOR_CATEGORY;
}

function isEffectFamily(prefix: string): prefix is EffectOperatorFamily {
  return prefix in EFFECT_FAMILY_CATEGORY;
}

/** Category of an effect head as it appears in a program; null when @almadar/core declares no such effect. */
export function effectCategoryOf(head: string): EffectCategory | null {
  if (isEffectOperator(head)) return EFFECT_OPERATOR_CATEGORY[head];
  const slash = head.indexOf('/');
  if (slash > 0) {
    const prefix = head.slice(0, slash);
    if (isEffectFamily(prefix)) return EFFECT_FAMILY_CATEGORY[prefix];
  }
  return null;
}

/** The literal core effect operator for a head, or null (families and unknown heads). */
export function asEffectOperator(head: string): EffectOperator | null {
  return isEffectOperator(head) ? head : null;
}

// ─── Operators (keyed on @almadar/std's OperatorCategory) ─────

// Categories @almadar/std's canonical-operators.json already ships but its built types do not yet declare (G-UI-091).
const PENDING_STD_CATEGORY_COLORS = {
  'std-behavior-value': avlBlend('var(--color-accent)', 40, 'var(--color-success)'),
  'std-program': avlBlend('var(--color-accent)', 60, 'var(--color-info)'),
};

export const OPERATOR_CATEGORY_COLORS: Record<OperatorCategory, string> = {
  ...PENDING_STD_CATEGORY_COLORS,
  'arithmetic': 'var(--color-primary)', 'comparison': 'var(--color-warning)', 'logic': 'var(--color-accent)',
  'control': 'var(--color-error)', 'effect': avlBlend('var(--color-warning)', 60, 'var(--color-error)'), 'collection': 'var(--color-info)',
  'std-math': 'var(--color-primary)', 'std-str': 'var(--color-success)', 'std-array': 'var(--color-info)',
  'std-object': avlBlend('var(--color-info)', 60, 'var(--color-foreground)'), 'std-validate': 'var(--color-warning)',
  'std-json': avlBlend('var(--color-success)', 60, 'var(--color-foreground)'), 'std-codec': avlBlend('var(--color-success)', 50, 'var(--color-warning)'), 'std-csv': avlBlend('var(--color-success)', 60, 'var(--color-info)'), 'std-time': avlBlend('var(--color-info)', 50, 'var(--color-success)'),
  'std-format': avlBlend('var(--color-success)', 60, 'var(--color-background)'), 'std-i18n': avlBlend('var(--color-info)', 60, 'var(--color-background)'),
  'std-prob': avlBlend('var(--color-accent)', 60, 'var(--color-warning)'),
  'std-os': avlBlend('var(--color-muted-foreground)', 60, 'var(--color-primary)'), 'std-kv': avlBlend('var(--color-muted-foreground)', 50, 'var(--color-info)'), 'std-browser': avlBlend('var(--color-muted-foreground)', 60, 'var(--color-info)'),
  'std-composition': avlBlend('var(--color-accent)', 60, 'var(--color-foreground)'), 'std-vec': avlBlend('var(--color-primary)', 60, 'var(--color-background)'),
  'std-geo': avlBlend('var(--color-success)', 50, 'var(--color-info)'), 'std-grid': avlBlend('var(--color-info)', 60, 'var(--color-background)'),
  'std-anim': avlBlend('var(--color-accent)', 60, 'var(--color-background)'), 'std-ease': avlBlend('var(--color-accent)', 50, 'var(--color-info)'),
  'std-noise': avlBlend('var(--color-muted-foreground)', 60, 'var(--color-accent)'), 'std-path': avlBlend('var(--color-success)', 60, 'var(--color-primary)'),
  'std-llm': avlBlend('var(--color-accent)', 70, 'var(--color-primary)'), 'std-workspace': avlBlend('var(--color-muted-foreground)', 60, 'var(--color-warning)'),
  'std-session': avlBlend('var(--color-muted-foreground)', 60, 'var(--color-success)'),
  'std-audio': avlBlend('var(--color-accent)', 50, 'var(--color-warning)'), 'std-auth': avlBlend('var(--color-warning)', 60, 'var(--color-primary)'),
  'std-trace': 'var(--color-muted-foreground)', 'std-behavior': avlBlend('var(--color-accent)', 60, 'var(--color-success)'),
};

/** Where an effect head lands; null when @almadar/core declares no such effect. */
export function effectZoneOf(head: string): EffectZone | null {
  if (isEffectOperator(head)) return EFFECT_OPERATOR_ZONE[head];
  const slash = head.indexOf('/');
  if (slash > 0) {
    const prefix = head.slice(0, slash);
    if (isEffectFamily(prefix)) return EFFECT_FAMILY_ZONE[prefix];
  }
  return null;
}
