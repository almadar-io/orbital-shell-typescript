/** A complete set of diagram tones and series, as an Orb theme declares them on a drawing's scope. */
export const DIAGRAM_SCOPE_VARS: Readonly<Record<string, string>> = {
  '--surface-diagram': 'rgb(250, 249, 246)',
  '--color-diagram-ink': 'rgb(20, 22, 26)',
  '--color-diagram-label': 'rgb(40, 42, 46)',
  '--color-diagram-axis': 'rgb(90, 92, 96)',
  '--color-diagram-grid': 'rgb(230, 228, 222)',
  '--color-diagram-guide': 'rgb(150, 150, 150)',
  '--color-diagram-fill': 'rgb(224, 240, 241)',
  '--color-diagram-highlight': 'rgb(0, 118, 124)',
  '--color-series-1': 'rgb(0, 118, 124)',
  '--color-series-2': 'rgb(200, 80, 40)',
  '--color-series-3': 'rgb(40, 160, 80)',
  '--color-series-4': 'rgb(80, 80, 200)',
  '--color-series-5': 'rgb(200, 160, 40)',
  '--color-series-6': 'rgb(160, 40, 160)',
  '--color-series-7': 'rgb(40, 160, 160)',
  '--color-series-8': 'rgb(120, 120, 120)',
};

/** A CSS rule declaring `vars` on `selector`: jsdom computes a custom property only where a rule or inline style declares it. */
export function scopeRule(selector: string, vars: Readonly<Record<string, string>>): string {
  return `${selector} { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')} }`;
}
