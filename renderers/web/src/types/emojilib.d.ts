declare module 'emojilib' {
  interface EmojilibEntry {
    keywords: string[];
    char: string;
    fitzpatrick_scale: boolean;
    category: string;
  }
  // CommonJS (`module.exports = {…}`): Node's ESM loader cannot resolve named
  // imports from it, so it is typed as `export =` and consumed via the default.
  const emojilib: {
    lib: Record<string, EmojilibEntry>;
    ordered: string[];
    fitzpatrick_scale_modifiers: string[];
  };
  export = emojilib;
}
