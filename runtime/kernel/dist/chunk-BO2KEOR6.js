import { isPageReference, themeDataKey } from '@almadar/core';

// src/client/render-sigils.ts
var DEFAULT_THEME_KEY = "minimalist-light";
function inlineNavItems(pages) {
  const items = [];
  for (const page of pages) {
    if (isPageReference(page)) continue;
    const p = page;
    if (typeof p.label !== "string" || p.path.includes(":")) continue;
    const item = { href: p.path, label: p.label };
    if (typeof p.icon === "string") item.icon = p.icon;
    if (p.roles !== void 0) item.roles = [...p.roles];
    items.push(item);
  }
  return items;
}
function appNavItems(orbitals) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  for (const orbital of orbitals) {
    for (const item of inlineNavItems(orbital.pages ?? [])) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      items.push(item);
    }
  }
  return items;
}
function sigilThemeKey(orbitalTheme, appThemeKey) {
  return themeDataKey(orbitalTheme) || appThemeKey || DEFAULT_THEME_KEY;
}

export { DEFAULT_THEME_KEY, appNavItems, inlineNavItems, sigilThemeKey };
