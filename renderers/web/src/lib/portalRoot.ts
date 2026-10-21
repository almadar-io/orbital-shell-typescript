/**
 * Shared portal root — all portaled content (modals, menus, tooltips, slots)
 * mounts here, above the host page. It carries no theme: each portal brings
 * its own through `ThemedPortal`. Kept in lib/ so UISlotRenderer and the
 * molecules share it without a circular import.
 */

export function getOrCreatePortalRoot(): HTMLElement {
  let root = document.getElementById("ui-slot-portal-root");
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
