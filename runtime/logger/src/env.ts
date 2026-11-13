/**
 * Env access compatible with Node, Vite, Webpack/Docusaurus, and plain
 * browsers. We deliberately do NOT touch `import.meta` here — esbuild's
 * optimizer inlines indirect eval forms back to the raw `import.meta`
 * token, which then breaks Webpack's static parse with
 * "Cannot use 'import.meta' outside a module".
 */
const ENV: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

export function envGet(key: string): string | undefined {
  return ENV[key] ?? ENV[`VITE_${key}`];
}

/**
 * The build's declared mode. Spelled as the literal `process.env.NODE_ENV` member so every bundler's
 * define replaces it; a browser bundle has no `process`, where the dynamic `envGet` reads nothing.
 */
export function nodeEnv(): string {
  let declared: string | undefined;
  try {
    declared = process.env.NODE_ENV;
  } catch {
    declared = undefined;
  }
  return declared ?? envGet('NODE_ENV') ?? 'development';
}
