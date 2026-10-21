/**
 * Arbitrary-value Tailwind classes (`w-[243px]`) in a schema exist only as
 * data, so build-time Tailwind never compiled them. A host that renders
 * schemas at runtime provides a compiler (e.g. the builder's server running
 * Tailwind with this package's preset — `@almadar/ui/tailwind-compile`);
 * `useArbitraryClassStyles(schema)` compiles each class once and appends its
 * CSS to one shared `<style>`. Without a provider it does nothing.
 */
import React, { createContext, useContext, useEffect, useMemo } from 'react';
import type { OrbitalSchema } from '@almadar/core';
import { arbitraryClassesOf } from '../lib/design-classes';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:arbitrary-classes');

export const ARBITRARY_CLASS_STYLE_ID = 'almadar-arbitrary-classes';

/** Compiles Tailwind classes to CSS. */
export type ArbitraryClassCompiler = (classes: string[]) => Promise<string>;

const CompilerContext = createContext<ArbitraryClassCompiler | null>(null);

export interface ArbitraryClassCompilerProviderProps {
  compile: ArbitraryClassCompiler;
  children: React.ReactNode;
}

export function ArbitraryClassCompilerProvider({ compile, children }: ArbitraryClassCompilerProviderProps): React.ReactElement {
  return <CompilerContext.Provider value={compile}>{children}</CompilerContext.Provider>;
}

// One document, one stylesheet: classes compile once however many previews show them.
const compiled = new Set<string>();
const pending = new Set<string>();

function appendCss(css: string): void {
  let el = document.getElementById(ARBITRARY_CLASS_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = ARBITRARY_CLASS_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `${el.textContent ?? ''}${css}\n`;
}

/** Forget what was compiled and drop the stylesheet (tests; a fresh document). */
export function resetArbitraryClassStyles(): void {
  compiled.clear();
  pending.clear();
  document.getElementById(ARBITRARY_CLASS_STYLE_ID)?.remove();
}

export function useArbitraryClassStyles(schema: OrbitalSchema | null | undefined): void {
  const compile = useContext(CompilerContext);
  const classes = useMemo(() => (schema ? arbitraryClassesOf(schema) : []), [schema]);

  useEffect(() => {
    if (!compile) return;
    const missing = classes.filter((c) => !compiled.has(c) && !pending.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => pending.add(c));
    compile(missing)
      .then((css) => {
        missing.forEach((c) => {
          pending.delete(c);
          compiled.add(c);
        });
        if (css) appendCss(css);
      })
      .catch((err: Error) => {
        // Not remembered as compiled, so the next render retries.
        missing.forEach((c) => pending.delete(c));
        log.warn('compile:failed', { classes: missing, error: err instanceof Error ? err.message : String(err) });
      });
  }, [compile, classes]);
}
