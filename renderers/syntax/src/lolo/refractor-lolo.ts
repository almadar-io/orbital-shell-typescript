/**
 * Refractor-compatible .lolo language definition.
 *
 * Refractor (used by react-syntax-highlighter) expects a function
 * that takes a Prism instance and registers a language. This wraps
 * registerLoloLanguage() in that format.
 *
 * Usage with react-syntax-highlighter:
 *   import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
 *   import { loloLanguage } from '@almadar/syntax';
 *   SyntaxHighlighter.registerLanguage('lolo', loloLanguage);
 *
 * Usage with refractor directly:
 *   import { refractor } from 'refractor/core';
 *   import { loloLanguage } from '@almadar/syntax';
 *   refractor.register(loloLanguage);
 */

import { registerLoloLanguage } from './prism-lolo.js';

/**
 * Refractor language definition function for .lolo files.
 * Registers the 'lolo' language with the Prism instance provided by refractor.
 */
export function loloLanguage(Prism: unknown): void {
  registerLoloLanguage(Prism as Record<string, unknown>);
}

loloLanguage.displayName = 'lolo';
loloLanguage.aliases = [] as string[];
