/**
 * Shared game display-font key → CSS font-family resolver.
 *
 * Used by both shell-level UI (GameShell) and canvas-level text (MathCanvas)
 * so a lolo `fontFamily: "future-narrow"` knob renders with the same face
 * whether it is painted by the DOM or by a canvas text pass.
 */

export const GAME_FONT_KEYS: Record<string, string> = {
  fredoka: "Fredoka",
  future: "Kenney Future",
  "future-narrow": "Kenney Future Narrow",
  pixel: "Kenney Pixel",
  blocks: "Kenney Blocks",
  mini: "Kenney Mini",
};

/**
 * Resolve a font-family prop value:
 *   - a known game key (e.g. "future-narrow") → "'Kenney Future Narrow', ui-sans-serif, system-ui, sans-serif"
 *   - any other value → returned as-is (assumed to be a CSS font-family string)
 *   - undefined/null → undefined
 */
export function resolveGameFontFamily(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const resolved = GAME_FONT_KEYS[input];
  if (resolved) return `'${resolved}', ui-sans-serif, system-ui, sans-serif`;
  return input;
}
