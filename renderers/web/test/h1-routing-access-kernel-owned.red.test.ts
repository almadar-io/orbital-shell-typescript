/**
 * RED BY DESIGN (H1, G-ORBITAL-SHELL-TYPESCRIPT-106, -107): the kernel's page circuit decides the route, the
 * not-found page, the nav trail and the access verdict; the web host only maps URL to it and paints. Each `it.fails`
 * passes while the TS copy exists and turns red when it is deleted (then remove the marker).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const text = (path: string) => readFileSync(src(path), 'utf8');

describe('G-ORBITAL-SHELL-TYPESCRIPT-106 red: routing is the kernel circuit', () => {
  it.fails('OrbPreview matches no route and picks no not-found page itself', () => {
    const preview = text('preview/OrbPreview.tsx');
    expect(preview).not.toMatch(/matchPathAmong|notFoundPage|comparePathSpecificity|matchRoute/);
  });

  it.fails('keeps no nav-stack derivation in the host', () => {
    expect(existsSync(src('core/lib/navStack.ts'))).toBe(false);
  });

  it.fails('keeps no route table or path matcher in the navigation provider', () => {
    expect(text('core/providers/navigation.tsx')).not.toMatch(/matchPath|findPageByPath|getDefaultPage/);
  });
});

describe('G-ORBITAL-SHELL-TYPESCRIPT-107 red: access is the kernel verdict', () => {
  it.fails('has no React page-access gate', () => {
    expect(existsSync(src('providers/PageAccessHost.tsx'))).toBe(false);
  });

  it.fails('UserContext evaluates no role or permission', () => {
    expect(text('providers/UserContext.tsx')).not.toMatch(/hasPermission|hasAnyRole|hasAllPermissions|hasRole/);
  });
});
