/** One tailwind-preset.cjs safelist line for a class: a double-quoted JS string when the class holds a single quote. */
export function safelistEntryLine(cls) {
  return cls.includes("'") ? `  ${JSON.stringify(cls)},` : `  '${cls}',`;
}
