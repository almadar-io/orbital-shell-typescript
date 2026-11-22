/**
 * Shared portal root — all portaled content (modals, menus, tooltips, slots)
 * mounts here, above the host page. It carries no theme: each portal brings
 * its own through `ThemedPortal`. Kept in lib/ so UISlotRenderer and the
 * molecules share it without a circular import.
 */

/** Set by the prerender snapshot on the portal root it serialized: the live render replaces that static content, as it replaces #root. */
export const PRERENDERED_MARK = "data-orb-prerendered";

export function getOrCreatePortalRoot(): HTMLElement {
  let root = document.getElementById("ui-slot-portal-root");
  if (root && root.hasAttribute(PRERENDERED_MARK)) {
    root.replaceChildren();
    root.removeAttribute(PRERENDERED_MARK);
  }
  if (!root) {
    root = document.createElement("div");
    root.id = "ui-slot-portal-root";
    // High z-index stacking context so portal content paints above host page
    root.style.position = "relative";
    root.style.zIndex = "9999";
    document.body.appendChild(root);
  }
  return root;
}
