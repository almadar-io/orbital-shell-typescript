/**
 * G-ORBITAL-SHELL-TYPESCRIPT-055: text whose class string sets no background is measured against the page ground,
 * so a reduced-opacity foreground (or an accent ink) on the page can no longer pass unmeasured.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

interface Failing {
  pair: string;
  sites: string[];
}

function audit(): Failing[] {
  const run = spawnSync(process.execPath, ['scripts/component-contrast-audit.mjs', '--json'], {
    cwd: resolve(__dirname, '../..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const report: { failing: Failing[] } = JSON.parse(run.stdout);
  return report.failing;
}

describe('component contrast audit: text on the page ground', () => {
  const failing = audit();
  it('measures status ink that has no background of its own (control: the extension is live)', () => {
    const warning = failing.find((f) => f.pair === 'text-warning on page');
    expect(warning?.sites.some((s) => s.endsWith('Alert.tsx:57'))).toBe(true);
  });
  it('keeps the paired inks (text-primary-foreground, text-background) off the page ground', () => {
    expect(failing.filter((f) => /text-(background|[a-z]+-foreground)(\/\d+)? on page/.test(f.pair) && !f.pair.startsWith('text-muted-foreground'))).toEqual([]);
  });
  it('no component paints a reduced-opacity foreground on the page', () => {
    expect(failing.filter((f) => /^(hover: )?text-(muted-)?foreground\/\d+ on page$/.test(f.pair))).toEqual([]);
  });
  it('the accent ink is not painted on the page ground in text (icons are the one ratcheted site)', () => {
    const accent = failing.find((f) => f.pair === 'text-accent on page');
    expect(accent?.sites).toEqual(['src/components/core/molecules/FeatureCard.tsx:76']);
    expect(failing.find((f) => f.pair === 'hover: text-accent on page')).toBeUndefined();
  });
});
