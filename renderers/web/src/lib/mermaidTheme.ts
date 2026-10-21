/**
 * mermaidTheme — the theme's drawing axes (see `resolveCanvasTheme`) mapped onto
 * mermaid's `base` theme variables, so diagrams draw with the same ground,
 * tones, series and label face as every other drawing surface.
 *
 * @packageDocumentation
 */

import type { CanvasTheme } from '@almadar/core';
import type { ResolvedMode } from '../core';

const PIE_SLOTS = 12;

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
