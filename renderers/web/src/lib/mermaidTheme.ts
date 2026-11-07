/**
 * mermaidTheme — the theme's drawing axes (see `resolveCanvasTheme`) mapped onto
 * mermaid's `base` theme variables, so diagrams draw with the same ground,
 * tones, series and label face as every other drawing surface.
 *
 * @packageDocumentation
 */

import { DIAGRAM_TONE_COLOR_KEYS, type CanvasTheme, type DiagramTone } from '@almadar/core';
import type { ResolvedMode } from '../core';

const PIE_SLOTS = 12;

const READ_TONES: readonly DiagramTone[] = ['ink', 'label', 'axis', 'grid', 'guide', 'fill', 'highlight'];
const SERIES_TONE_IDS: readonly DiagramTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

/** A tone mermaid draws with did not resolve on the theme's scope; mermaid's colour parser would throw on it. */
export class UnresolvedThemeToneError extends Error {
  constructor(readonly tones: readonly DiagramTone[]) {
    super(`diagram tones unresolved on the scope: declare ${tones.map((t) => `--color-${DIAGRAM_TONE_COLOR_KEYS[t]}`).join(', ')}`);
    this.name = 'UnresolvedThemeToneError';
  }
}

export interface MermaidThemeVariables {
  darkMode: boolean;
  background: string;
  fontFamily: string;
  fontSize: string;
  primaryColor: string;
  primaryBorderColor: string;
  primaryTextColor: string;
  secondaryColor: string;
  secondaryBorderColor: string;
  secondaryTextColor: string;
  tertiaryColor: string;
  tertiaryBorderColor: string;
  tertiaryTextColor: string;
  textColor: string;
  nodeTextColor: string;
  lineColor: string;
  edgeLabelBackground: string;
  clusterBkg: string;
  clusterBorder: string;
  titleColor: string;
  noteBkgColor: string;
  noteBorderColor: string;
  noteTextColor: string;
  actorBkg: string;
  actorBorder: string;
  actorTextColor: string;
  actorLineColor: string;
  signalColor: string;
  signalTextColor: string;
  labelBoxBkgColor: string;
  labelBoxBorderColor: string;
  labelTextColor: string;
  activationBkgColor: string;
  activationBorderColor: string;
  pieTitleTextColor: string;
  pieSectionTextColor: string;
  pieStrokeColor: string;
  pieOuterStrokeColor: string;
  pieOpacity: string;
  [pie: `pie${number}`]: string;
}

export function mermaidThemeVariables(theme: CanvasTheme, mode: ResolvedMode): MermaidThemeVariables {
  const { tones, series } = theme;
  const drawnSeries = SERIES_TONE_IDS.filter((_, i) => i < series.length && i < PIE_SLOTS);
  const missing = [...READ_TONES, ...drawnSeries].filter((t) => theme.unresolvedTones.includes(t));
  if (missing.length > 0) throw new UnresolvedThemeToneError(missing);
  const seriesAt = (i: number): string => series[i % series.length] ?? tones.highlight;
  const vars: MermaidThemeVariables = {
    darkMode: mode === 'dark',
    background: theme.ground,
    fontFamily: theme.faces[theme.label.font],
    fontSize: `${theme.text[theme.label.size]}px`,
    primaryColor: tones.fill,
    primaryBorderColor: tones.ink,
    primaryTextColor: tones.label,
    secondaryColor: tones.grid,
    secondaryBorderColor: tones.guide,
    secondaryTextColor: tones.label,
    tertiaryColor: theme.ground,
    tertiaryBorderColor: tones.guide,
    tertiaryTextColor: tones.label,
    textColor: tones.label,
    nodeTextColor: tones.label,
    lineColor: tones.axis,
    edgeLabelBackground: theme.ground,
    clusterBkg: tones.grid,
    clusterBorder: tones.guide,
    titleColor: tones.ink,
    noteBkgColor: tones.fill,
    noteBorderColor: tones.highlight,
    noteTextColor: tones.label,
    actorBkg: tones.fill,
    actorBorder: tones.ink,
    actorTextColor: tones.label,
    actorLineColor: tones.guide,
    signalColor: tones.axis,
    signalTextColor: tones.label,
    labelBoxBkgColor: tones.fill,
    labelBoxBorderColor: tones.ink,
    labelTextColor: tones.label,
    activationBkgColor: tones.grid,
    activationBorderColor: tones.ink,
    pieTitleTextColor: tones.ink,
    pieSectionTextColor: theme.ground,
    pieStrokeColor: theme.ground,
    pieOuterStrokeColor: tones.guide,
    pieOpacity: '1',
  };
  for (let i = 0; i < PIE_SLOTS; i++) vars[`pie${i + 1}`] = seriesAt(i);
  return vars;
}
