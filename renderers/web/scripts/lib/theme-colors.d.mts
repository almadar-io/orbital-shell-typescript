export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ThemeMode {
  file: string;
  name: string;
  raw(varName: string): string | undefined;
  color(varName: string): Rgba | null;
}

export function parseColor(raw: string): Rgba | null;
export function compositeOver(fg: Rgba, bg: Rgba): Rgba;
export function contrast(c1: Rgba, c2: Rgba): number;
export function loadThemeModes(themesDir: string, filter?: string): ThemeMode[];
export function pairContrast(mode: ThemeMode, fg: Rgba | null, bg: Rgba | null): number | null;
