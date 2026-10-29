import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { Button } from '../../src/core/atoms/Button';
import { Input } from '../../src/core/atoms/Input';
import { Radio } from '../../src/core/atoms/Radio';
import { Checkbox } from '../../src/core/atoms/Checkbox';
import { Divider } from '../../src/core/atoms/Divider';
import { ProgressBar } from '../../src/core/atoms/ProgressBar';
import { Spinner } from '../../src/core/atoms/Spinner';
import { Switch } from '../../src/core/atoms/Switch';
import { Textarea } from '../../src/core/atoms/Textarea';
import { Alert } from '../../src/components/core/molecules/Alert';
import { Avatar } from '../../src/core/atoms/Avatar';
import { StatusDot } from '../../src/core/atoms/StatusDot';
import { TrendIndicator } from '../../src/core/atoms/TrendIndicator';
import { Image } from '../../src/core/atoms/Image';
import { Skeleton } from '../../src/components/core/molecules/Skeleton';
import { StarRating } from '../../src/components/core/molecules/StarRating';
import { LikertScale } from '../../src/components/core/molecules/LikertScale';
import { DocBreadcrumb } from '../../src/components/core/molecules/DocBreadcrumb';
import { Tabs } from '../../src/components/core/molecules/Tabs';
import { DocTOC } from '../../src/components/core/molecules/DocTOC';
import { DocSidebar } from '../../src/components/core/molecules/DocSidebar';
import { DocPagination } from '../../src/components/core/molecules/DocPagination';
import { axeViolations, describeViolations } from './axe';
import { loadThemeModes, pairContrast } from '../../scripts/lib/theme-colors.mjs';

const WEB = resolve(import.meta.dirname, '../..');
const REGISTRY = resolve(WEB, '../../core/src/patterns/patterns-registry.json');
const MIN_CONTRAST = 4.5;

type Motion = 'none' | 'css' | 'script';

interface Declaration {
  type: string;
  sourceFile: string;
  role: string;
  tokens: string[];
  contrast: Array<{ fg: string; bg: string }>;
  motion: Motion;
}

interface RegistryEntry {
  sourceFile: string;
}

/** The declaration block is the JSDoc of the Props interface, the one place pattern-sync reads `@accessibleName` from. */
function propsTags(source: string): Map<string, string[]> | null {
  for (const m of source.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export interface \w+Props\b/g)) {
    const tags = new Map<string, string[]>();
    for (const line of m[1].split('\n')) {
      const t = line.replace(/^\s*\*?\s?/, '').match(/^@(\w+)\s*(.*)$/);
      if (t) tags.set(t[1], [...(tags.get(t[1]) ?? []), t[2].trim()]);
    }
    if (tags.has('role')) return tags;
  }
  return null;
}

function declarations(): Declaration[] {
  const registry: { patterns: Record<string, RegistryEntry> } = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const out: Declaration[] = [];
  for (const [type, entry] of Object.entries(registry.patterns)) {
    const tags = propsTags(readFileSync(resolve(WEB, 'src', entry.sourceFile), 'utf8'));
    if (!tags) continue;
    const one = (name: string): string => {
      const v = tags.get(name);
      if (!v || v.length !== 1) throw new Error(`${type}: @${name} must be declared exactly once`);
      return v[0];
    };
    const motion = one('motion');
    if (motion !== 'none' && motion !== 'css' && motion !== 'script') throw new Error(`${type}: @motion ${motion} is not none|css|script`);
    out.push({
      type,
      sourceFile: entry.sourceFile,
      role: one('role'),
      tokens: one('tokens').split(/\s+/),
      contrast: (tags.get('contrast') ?? []).map((c) => {
        const [fg, bg] = c.split(/\s+/);
        return { fg, bg };
      }),
      motion,
    });
  }
  return out;
}

const SAMPLES: Record<string, () => React.ReactElement> = {
  button: () => <Button label="Save" />,
  switch: () => <Switch label="Notifications" />,
  checkbox: () => <Checkbox label="Agree" />,
  radio: () => <Radio label="Option" name="g" />,
  input: () => <Input label="Name" />,
  textarea: () => <Textarea label="Notes" />,
  alert: () => <Alert message="Saved" variant="success" />,
  'progress-bar': () => <ProgressBar value={40} label="Upload" />,
  divider: () => <Divider />,
  spinner: () => <Spinner />,
  avatar: () => <Avatar src="https://example.test/ada.png" alt="Ada Lovelace" />,
  'status-dot': () => <StatusDot status="online" label="Online" />,
  'trend-indicator': () => <TrendIndicator value={12} />,
  skeleton: () => <Skeleton variant="text" />,
  image: () => <Image src="https://example.test/a.png" alt="A chart" />,
  'star-rating': () => <StarRating value={3} readOnly label="Rating" />,
  'likert-scale': () => <LikertScale question="Ease of use" aria-label="Ease of use" />,
  'doc-breadcrumb': () => <DocBreadcrumb items={[{ label: 'Docs', href: '/docs' }, { label: 'Page' }]} />,
  tabs: () => <Tabs aria-label="Sections" items={[{ id: 'a', label: 'One', content: 'First' }, { id: 'b', label: 'Two', content: 'Second' }]} />,
  'doc-toc': () => <DocTOC items={[{ id: 'intro', label: 'Intro', level: 2 }, { id: 'setup', label: 'Setup', level: 2 }]} />,
  'doc-sidebar': () => <DocSidebar items={[{ label: 'Guide', href: '/guide' }, { label: 'Reference', href: '/ref' }]} />,
  'doc-pagination': () => <DocPagination prev={{ label: 'Intro', href: '/intro' }} next={{ label: 'Setup', href: '/setup' }} />,
};

const EXPECTED_CONTRAST_FAILURES_066 = new Set([
  'checkbox|foreground|card|game-adventure-dark',
  'checkbox|foreground|card|game-ui-pack-dark',
  'checkbox|foreground|card|win95-light',
  'input|foreground|card|game-adventure-dark',
  'input|foreground|card|game-ui-pack-dark',
  'input|foreground|card|win95-light',
  'textarea|foreground|card|game-adventure-dark',
  'textarea|foreground|card|game-ui-pack-dark',
  'textarea|foreground|card|win95-light',
  'avatar|foreground|muted|game-adventure-dark',
  'avatar|foreground|muted|game-ui-pack-dark',
  'avatar|foreground|muted|win95-light',
  'doc-breadcrumb|muted-foreground|background|game-adventure-dark',
  'doc-breadcrumb|muted-foreground|background|game-ui-pack-dark',
  'doc-breadcrumb|muted-foreground|background|win95-light',
  'doc-pagination|muted-foreground|background|game-adventure-dark',
  'doc-pagination|muted-foreground|background|game-ui-pack-dark',
  'doc-pagination|muted-foreground|background|win95-light',
  'tabs|muted-foreground|background|game-adventure-dark',
  'tabs|muted-foreground|background|game-ui-pack-dark',
  'tabs|muted-foreground|background|win95-light',
  'doc-toc|muted-foreground|background|game-adventure-dark',
  'doc-toc|muted-foreground|background|game-ui-pack-dark',
  'doc-toc|muted-foreground|background|win95-light',
  'doc-sidebar|muted-foreground|background|game-adventure-dark',
  'doc-sidebar|muted-foreground|background|game-ui-pack-dark',
  'doc-sidebar|muted-foreground|background|win95-light',
]);

const declared = declarations();
const modes = loadThemeModes(resolve(WEB, 'themes'));

const COLOR_UTILITY = '(?:text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|accent|shadow|decoration)';

/** Whether the component source reads the token: `var(--x)` or, for `--color-x`, a Tailwind colour utility on `x`. */
function readsToken(source: string, token: string): boolean {
  if (source.includes(`var(${token}`)) return true;
  const color = token.match(/^--color-([a-z][a-z0-9-]*)$/);
  return color !== null && new RegExp(`\\b${COLOR_UTILITY}-${color[1]}(?![a-z0-9-])`).test(source);
}

describe('conformance controls', () => {
  it('a wrong role is not found on a rendered sample', () => {
    const { container } = render(<EventBusProvider debug={false}><Button label="Save" /></EventBusProvider>);
    expect(within(container).queryAllByRole('switch')).toEqual([]);
  });

  it('an unnamed control is caught by axe', async () => {
    const { container } = render(<EventBusProvider debug={false}><Switch /></EventBusProvider>);
    expect((await axeViolations(container)).length).toBeGreaterThan(0);
  });

  it('a token the source never reads is not read', () => {
    expect(readsToken('className="bg-primary"', '--color-warning')).toBe(false);
    expect(readsToken('className="bg-primary-foreground"', '--color-primary')).toBe(false);
  });
});

describe('pattern conformance, driven by the declarations on the Props interfaces', () => {
  it('finds the declared patterns', () => {
    expect(declared.map((d) => d.type).sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  for (const d of declared) {
    describe(d.type, () => {
      const source = readFileSync(resolve(WEB, 'src', d.sourceFile), 'utf8');
      const sample = SAMPLES[d.type];

      it('renders its declared role', () => {
        const { container } = render(<EventBusProvider debug={false}>{sample()}</EventBusProvider>);
        expect(within(container).queryAllByRole(d.role).length).toBeGreaterThan(0);
      });

      it('has no axe violations', async () => {
        const { container } = render(<EventBusProvider debug={false}>{sample()}</EventBusProvider>);
        expect(describeViolations(await axeViolations(container))).toEqual([]);
      });

      it('reads every declared token, and every theme mode defines it', () => {
        for (const token of d.tokens) {
          expect(readsToken(source, token), `${d.sourceFile} does not read ${token}`).toBe(true);
          if (token.startsWith('--color-')) {
            const missing = modes.filter((m) => !m.color(token)).map((m) => m.name);
            expect(missing, `${token} undefined in theme modes`).toEqual([]);
          }
        }
      });

      for (const pair of d.contrast) {
        it(`meets ${MIN_CONTRAST}:1 for ${pair.fg} on ${pair.bg} in every theme mode`, () => {
          const observed = new Set<string>();
          for (const mode of modes) {
            const fg = mode.color(`--color-${pair.fg}`);
            const bg = mode.color(`--color-${pair.bg}`);
            const ratio = fg && bg ? pairContrast(mode, fg, bg) : null;
            if (ratio !== null && ratio < MIN_CONTRAST) observed.add(`${d.type}|${pair.fg}|${pair.bg}|${mode.name}`);
          }
          const expected = [...EXPECTED_CONTRAST_FAILURES_066].filter((k) => k.startsWith(`${d.type}|${pair.fg}|${pair.bg}|`));
          expect([...observed].sort(), 'G-ORBITAL-SHELL-TYPESCRIPT-066 ratchet').toEqual(expected.sort());
        });
      }

      it(`keeps its declared motion (${d.motion})`, () => {
        const css = /\banimate-|\btransition/.test(source);
        const script = /requestAnimationFrame|setInterval/.test(source);
        const honorsReduced = /motion-enable|prefers-reduced-motion|useReducedMotion/.test(source);
        if (d.motion === 'none') expect(css || script).toBe(false);
        if (d.motion === 'css') expect(script).toBe(false);
        if (d.motion === 'script') expect(honorsReduced).toBe(true);
      });
    });
  }
});
