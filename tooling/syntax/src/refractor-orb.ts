/**
 * Refractor-compatible .orb language definition.
 *
 * Refractor (used by react-syntax-highlighter) expects a function
 * that takes Prism and registers a language. This wraps
 * registerOrbLanguage() in that format.
 *
 * Usage:
 *   import { orbLanguage } from '@almadar/syntax';
 *   SyntaxHighlighter.registerLanguage('orb', orbLanguage);
 */

import { registerOrbLanguage } from './prism-orb.js';

/**
 * Refractor language definition function for .orb files.
 * Registers the 'orb' language with the Prism instance provided by refractor.
 */
export function orbLanguage(Prism: unknown): void {
  registerOrbLanguage(Prism as Record<string, unknown>);
}

// Refractor expects displayName and aliases
orbLanguage.displayName = 'orb';
orbLanguage.aliases = [] as string[];
