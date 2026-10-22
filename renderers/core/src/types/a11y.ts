/**
 * Accessibility attribute vocabulary — the one source every layer reads.
 *
 * `@almadar/ui` components that forward these to their element declare
 * `extends A11yProps`; `@almadar/pattern-sync` expands `A11Y_ATTRIBUTES` into
 * those patterns' `propsSchema`, so `.lolo` render-ui can set them and both
 * execution paths (runtime + compiled) admit them.
 *
 * @packageDocumentation
 */

import { z } from "zod";

export const ARIA_LIVE = ["off", "polite", "assertive"] as const;
export type AriaLive = (typeof ARIA_LIVE)[number];

export const ARIA_CURRENT = ["page", "step", "location", "date", "time", "true", "false"] as const;
export type AriaCurrent = (typeof ARIA_CURRENT)[number];

export const ARIA_PRESSED = ["true", "false", "mixed"] as const;
export type AriaPressed = (typeof ARIA_PRESSED)[number];

export const TEXT_DIRECTIONS = ["ltr", "rtl", "auto"] as const;
export type TextDirection = (typeof TEXT_DIRECTIONS)[number];

/** Focus order a pattern may opt into: in order (0) or programmatic-only (-1). */
export const TAB_INDEX_VALUES = [-1, 0] as const;
export type TabIndexValue = (typeof TAB_INDEX_VALUES)[number];

/** WAI-ARIA 1.2 non-abstract roles. */
export const ARIA_ROLES = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button",
  "caption", "cell", "checkbox", "code", "columnheader", "combobox", "complementary",
  "contentinfo", "definition", "deletion", "dialog", "document", "emphasis", "feed",
  "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img", "insertion",
  "link", "list", "listbox", "listitem", "log", "main", "marquee", "math", "menu",
  "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "meter", "navigation",
  "none", "note", "option", "paragraph", "presentation", "progressbar", "radio",
  "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "search",
  "searchbox", "separator", "slider", "spinbutton", "status", "strong", "subscript",
  "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
  "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
] as const;
export type AriaRole = (typeof ARIA_ROLES)[number];
export const AriaRoleSchema = z.enum(ARIA_ROLES);

const ARIA_ROLE_SET: ReadonlySet<string> = new Set(ARIA_ROLES);

export function isAriaRole(value: string): value is AriaRole {
  return ARIA_ROLE_SET.has(value);
}

/** ARIA's boolean attribute values, as React accepts them. */
export type AriaBooleanish = boolean | "true" | "false";

/**
 * The props an accessible pattern forwards to its element. Typed as React
 * accepts them (TSX call sites); `.lolo` gets the narrower A11Y_ATTRIBUTES.
 */
export interface A11yProps {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-live"?: AriaLive;
  "aria-current"?: AriaCurrent | boolean;
  "aria-pressed"?: AriaBooleanish | "mixed";
  "aria-expanded"?: AriaBooleanish;
  "aria-selected"?: AriaBooleanish;
  "aria-hidden"?: AriaBooleanish;
  "aria-busy"?: AriaBooleanish;
  role?: AriaRole;
  lang?: string;
  dir?: TextDirection;
  tabIndex?: number;
}

/** A11yProps as propsSchema entries (the registry's prop shape). */
export interface A11yAttributeSchema {
  types: ["string"] | ["boolean"] | ["number"];
  description: string;
  enumValues?: readonly string[];
  numericEnumValues?: readonly number[];
}

export const A11Y_ATTRIBUTES: Record<keyof A11yProps, A11yAttributeSchema> = {
  "aria-label": { types: ["string"], description: "Accessible name read by screen readers when the visible text is missing or not descriptive (e.g. an icon-only control)." },
  "aria-labelledby": { types: ["string"], description: "Id of the element whose text names this one." },
  "aria-describedby": { types: ["string"], description: "Id of the element whose text describes this one (help text, error)." },
  "aria-live": { types: ["string"], enumValues: ARIA_LIVE, description: "Announce changes to this region: polite waits for a pause, assertive interrupts." },
  "aria-current": { types: ["string"], enumValues: ARIA_CURRENT, description: "Marks the current item in a set: the current page, step, location, date or time." },
  "aria-pressed": { types: ["string"], enumValues: ARIA_PRESSED, description: "Toggle-button state." },
  "aria-expanded": { types: ["boolean"], description: "Whether the element it controls is expanded." },
  "aria-selected": { types: ["boolean"], description: "Whether this item is selected (tabs, options, grid cells)." },
  "aria-hidden": { types: ["boolean"], description: "Hide from assistive technology (decorative content only)." },
  "aria-busy": { types: ["boolean"], description: "This region is updating; assistive technology waits before announcing it." },
  role: { types: ["string"], enumValues: ARIA_ROLES, description: "WAI-ARIA role when the element's native semantics don't describe it." },
  lang: { types: ["string"], description: "Language of this element's content (BCP 47, e.g. ar, sl, en)." },
  dir: { types: ["string"], enumValues: TEXT_DIRECTIONS, description: "Text direction of this element's content." },
  tabIndex: { types: ["number"], numericEnumValues: TAB_INDEX_VALUES, description: "0 puts the element in the Tab order; -1 makes it focusable only programmatically." },
};

/** Props that give an element its accessible name. */
export const ACCESSIBLE_NAME_ATTRIBUTES = ["aria-label", "aria-labelledby"] as const;
