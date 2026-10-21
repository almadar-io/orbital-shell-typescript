'use client';
/**
 * Menu Molecule Component
 *
 * A dropdown menu component with items, icons, dividers, and sub-menus.
 * Uses theme-aware CSS variables for styling.
 */

import { actionTestId } from '@almadar/core';
import React, { useState, useRef, useEffect, useId, useLayoutEffect } from "react";
import { useTapReveal } from '../../../core';
import { Box } from '../../../core';
import type { IconInput } from '../../../core';
import { Icon } from '../../../core';
import { Divider } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useNavStack } from '../../../core';
import { followHref } from '../../../core';
import type { EventKey, A11yProps } from "@almadar/core";
import { ThemedPortal } from "../../../lib/ThemedPortal";
import { useDialogBehavior } from '../../../core';

import { domPassthrough } from '../../../core';

const TRIGGER_CONTROL_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
export interface MenuItem {
  /** `divider` renders a separator line instead of an item */
  type?: "item" | "divider";
  /** Item ID (auto-generated from label if not provided) */
  id?: string;
  /** Item label */
  label: string;
  /** Item icon (Lucide icon name or component) */
  icon?: IconInput;
  /** Item badge */
  badge?: string | number;
  /** Disable item */
  disabled?: boolean;
  /** Tooltip text (e.g. why a disabled item is disabled) */
  title?: string;
  /** Item click handler */
  onClick?: () => void;
  /** Bus event this item fires on pick — unless `onClick` is set, which then owns firing (`event` then only names the item, e.g. its `action-<EVENT>` test id). */
  event?: EventKey;
  /** Link this item follows on pick: an in-app path (nav stack), `#anchor` or absolute URL. */
  href?: string;
  /** File URL this item downloads on pick (gesture-driven, `DocumentViewer` precedent). The item's `event` still emits on the bus. */
  url?: string;
  /** Variant for styling (pattern compatibility) */
  variant?: "default" | "danger";
  /** Sub-menu items */
  subMenu?: MenuItem[];
}

export type MenuPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

/**
 * Subset of props Menu's `React.cloneElement` injects into the trigger
 * child. Typing the clone target as `React.ReactElement<MenuTriggerProps>`
 * keeps the call totally — no `any`, no `unknown` — while letting
 * arbitrary additional props on the underlying element pass through.
 */
interface MenuTriggerProps {
  ref?: React.Ref<HTMLElement>;
  onClick?: React.MouseEventHandler<HTMLElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}

export interface MenuProps extends A11yProps {
  /** Menu trigger element */
  trigger: React.ReactNode;
  /** Menu items */
  items: MenuItem[];
  /** Menu position */
  position?: MenuPosition;
  /** Additional CSS classes */
  className?: string;
  /** Optional slot rendered above the items. */
  header?: React.ReactNode;
  /** Optional slot rendered below the items. */
  footer?: React.ReactNode;
}

const MENU_GAP = 4;

type MenuFocusTarget = "first" | "last" | "next" | "prev";

// Roving focus across the menu's own items (a submenu is a separate menu).
function focusMenuItem(menu: HTMLElement | null, target: MenuFocusTarget): void {
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll<HTMLElement>(':scope > [role="menuitem"], :scope > * > [role="menuitem"]'));
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const index =
    target === "first" ? 0
    : target === "last" ? items.length - 1
    : target === "next" ? (at + 1) % items.length
    : (at - 1 + items.length) % items.length;
  items[index].focus();
}

const MENU_NAV_KEYS: Record<string, MenuFocusTarget> = {
  ArrowDown: "next",
  ArrowUp: "prev",
  Home: "first",
  End: "last",
};

// Gesture-driven file save for `MenuItem.url` — an anchor with `download` keeps
// image/JSON URLs saving instead of navigating (same-origin; falls back to
// opening the file for cross-origin URLs, per the download-attribute spec).
// `data:` URIs (embedded sprite sheets) have no path — the item label names the file.
function downloadItemUrl(url: string, label: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = url.startsWith("data:") ? label : (url.split("/").pop() ?? "download");
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Compute fixed viewport coords for the dropdown panel given the trigger rect
// and the desired position. Returns inline style to apply to the portaled div.
function computeMenuStyle(
  position: string,
  triggerRect: DOMRect,
): React.CSSProperties {
  const isTop = position.startsWith("top");
  const isRight = position.endsWith("right") || position.endsWith("end");

  if (isTop) {
    return {
      top: triggerRect.top - MENU_GAP,
      transform: "translateY(-100%)",
      ...(isRight
        ? { right: window.innerWidth - triggerRect.right }
        : { left: triggerRect.left }),
    };
  }
  return {
    top: triggerRect.bottom + MENU_GAP,
    ...(isRight
      ? { right: window.innerWidth - triggerRect.right }
      : { left: triggerRect.left }),
  };
}

const menuContainerStyles = cn(
  "bg-card",
  "border-[length:var(--border-width)] border-border",
  "shadow-elevation-popover",
  "rounded-container",
  "min-w-0 sm:min-w-[200px] max-w-[calc(100vw-1rem)] py-1",
);

// Submenu that portals to body and positions itself relative to the item row.
function SubMenu({
  items,
  itemRef,
  direction,
  eventBus,
  autoFocus,
  onClose,
  onActivate,
}: {
  items: MenuItem[];
  itemRef: HTMLElement | null;
  direction: string;
  eventBus: ReturnType<typeof useEventBus>;
  autoFocus: boolean;
  onClose: () => void;
  onActivate: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const navStack = useNavStack();
  const subRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rect && autoFocus) focusMenuItem(subRef.current, "first");
  }, [rect, autoFocus]);

  useEffect(() => {
    if (itemRef) {
      setRect(itemRef.getBoundingClientRect());
    }
  }, [itemRef]);

  if (!rect) return null;

  const isRtl = direction === "rtl";
  const style: React.CSSProperties = {
    top: rect.top,
    ...(isRtl
      ? { right: window.innerWidth - rect.left }
      : { left: rect.right }),
  };

  const backKey = isRtl ? "ArrowRight" : "ArrowLeft";
  const panel = (
    <div
      ref={subRef}
      role="menu"
      className={cn("fixed z-50", menuContainerStyles)}
      style={style}
      onKeyDown={(e: React.KeyboardEvent) => {
        const nav = MENU_NAV_KEYS[e.key];
        if (nav) {
          e.preventDefault();
          e.stopPropagation();
          focusMenuItem(subRef.current, nav);
        } else if (e.key === backKey || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {items.map((item, index) => {
        const isDivider = item.type === "divider";
        const itemId =
          item.id ??
          `item-${item.label.toLowerCase().replace(/\s+/g, "-")}-${index}`;
        const isDanger = item.variant === "danger";

        if (isDivider) {
          return <Divider key={`divider-${index}`} className="my-1" />;
        }

        return (
          <Box
            key={itemId}
            as="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              if (item.disabled) return;
              // One firing path per item: an onClick owns it (and emits its own payload); `event` alone emits here.
      if (item.event && !item.onClick) eventBus.emit(`UI:${item.event}`, { itemId, label: item.label });
              if (item.url) downloadItemUrl(item.url, item.label);
              if (item.href !== undefined) followHref(item.href, navStack);
              item.onClick?.();
              onActivate();
            }}
            aria-disabled={item.disabled || undefined}
            title={item.title}
            data-testid={item.event ? actionTestId(item.event) : undefined}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 text-start",
              "text-sm transition-colors",
              "hover:bg-muted focus:outline-none focus:bg-muted",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              item.disabled && "cursor-not-allowed",
              isDanger && "text-foreground hover:bg-error/10 border-s-heavy border-error",
            )}
          >
            {item.icon &&
              (typeof item.icon === "string" ? (
                <Icon name={item.icon} size="sm" className={cn("flex-shrink-0", isDanger && "text-error")} />
              ) : (
                <Icon icon={item.icon} size="sm" className={cn("flex-shrink-0", isDanger && "text-error")} />
              ))}
            <Typography variant="small" className="flex-1">
              {item.label}
            </Typography>
            {item.badge !== undefined && (
              <span className="ml-auto text-xs font-medium">{item.badge}</span>
            )}
          </Box>
        );
      })}
    </div>
  );

  return typeof document !== "undefined" ? (<ThemedPortal>{panel}</ThemedPortal>) : panel;
}

// One menu row. Submenus open on hover, which never fires on touch — so a tap
// opens the submenu through the SAME open path (`openSubMenu`) via `useTapReveal`.
function MenuItemRow({
  item,
  itemId,
  hasSubMenu,
  isDanger,
  direction,
  isSubMenuOpen,
  subMenuAutoFocus,
  activeSubMenuRef,
  eventBus,
  onItemClick,
  openSubMenu,
  closeSubMenu,
  closeMenu,
}: {
  item: MenuItem;
  itemId: string;
  hasSubMenu: boolean;
  isDanger: boolean;
  direction: string;
  isSubMenuOpen: boolean;
  subMenuAutoFocus: boolean;
  activeSubMenuRef: HTMLElement | null;
  eventBus: ReturnType<typeof useEventBus>;
  onItemClick: (item: MenuItem, itemId: string) => void;
  openSubMenu: (itemId: string, el: HTMLElement | null, focusFirst?: boolean) => void;
  closeSubMenu: () => void;
  closeMenu: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const openKey = direction === "rtl" ? "ArrowLeft" : "ArrowRight";

  const { triggerProps } = useTapReveal({
    enabled: hasSubMenu,
    onReveal: () => openSubMenu(itemId, rowRef.current),
    refs: [rowRef],
  });

  return (
    <Box>
      <Box
        ref={rowRef}
        as="button"
        role="menuitem"
        tabIndex={-1}
        aria-haspopup={hasSubMenu ? "menu" : undefined}
        aria-expanded={hasSubMenu ? isSubMenuOpen : undefined}
        onClick={() => onItemClick({ ...item, id: itemId }, itemId)}
        onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
          if (hasSubMenu && e.key === openKey) {
            e.preventDefault();
            e.stopPropagation();
            openSubMenu(itemId, e.currentTarget, true);
          }
        }}
        aria-disabled={item.disabled || undefined}
        title={item.title}
        onMouseEnter={(e: React.MouseEvent<HTMLElement>) => {
          if (hasSubMenu) openSubMenu(itemId, e.currentTarget);
        }}
        onPointerDown={hasSubMenu ? triggerProps.onPointerDown : undefined}
        data-testid={item.event ? actionTestId(item.event) : undefined}
        className={cn(
          "w-full flex items-center justify-between gap-3 px-4 py-2 text-start",
          "text-sm transition-colors",
          "hover:bg-muted",
          "focus:outline-none focus:bg-muted",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          item.disabled && "cursor-not-allowed",
          isDanger && "text-foreground hover:bg-error/10 border-s-heavy border-error",
        )}
      >
        <Box className="flex items-center gap-3 flex-1 min-w-0">
          {item.icon &&
            (typeof item.icon === "string" ? (
              <Icon name={item.icon} size="sm" className={cn("flex-shrink-0", isDanger && "text-error")} />
            ) : (
              <Icon icon={item.icon} size="sm" className={cn("flex-shrink-0", isDanger && "text-error")} />
            ))}
          <Typography
            variant="small"
            className="flex-1"
          >
            {item.label}
          </Typography>
          {item.badge !== undefined && (
            <Badge variant="default" size="sm">
              {item.badge}
            </Badge>
          )}
          {hasSubMenu && (
            <Icon
              name={direction === "rtl" ? "chevron-left" : "chevron-right"}
              size="sm"
              className="flex-shrink-0"
            />
          )}
        </Box>
      </Box>
      {hasSubMenu && isSubMenuOpen && item.subMenu && (
        <SubMenu
          items={item.subMenu}
          itemRef={activeSubMenuRef}
          direction={direction}
          eventBus={eventBus}
          autoFocus={subMenuAutoFocus}
          onClose={() => {
            closeSubMenu();
            rowRef.current?.focus();
          }}
          onActivate={closeMenu}
        />
      )}
    </Box>
  );
}

export const Menu: React.FC<MenuProps> = ({
  trigger,
  items,
  position = "bottom-left",
  className,
  header,
  footer,
  ...rest
}) => {
  const eventBus = useEventBus();
  const navStack = useNavStack();
  const { direction } = useTranslate();
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);
  const [activeSubMenuRef, setActiveSubMenuRef] = useState<HTMLElement | null>(null);
  const [subMenuAutoFocus, setSubMenuAutoFocus] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  // A wrapped trigger that already holds a control (a render-ui `button`
  // pattern): that control carries the menu semantics and keeps focus, so the
  // wrapper never becomes a second button around it.
  const [innerControl, setInnerControl] = useState<HTMLElement | null>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const updatePosition = () => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
  };

  const handleToggle = () => {
    if (!isOpen) {
      updatePosition();
    }
    setIsOpen(!isOpen);
    setActiveSubMenu(null);
    setActiveSubMenuRef(null);
  };

  const handleItemClick = (item: MenuItem, itemId: string) => {
    if (item.disabled) return;

    if (item.subMenu && item.subMenu.length > 0) {
      setActiveSubMenu(itemId);
    } else {
      // One firing path per item: an onClick owns it (and emits its own payload); `event` alone emits here.
      if (item.event && !item.onClick) eventBus.emit(`UI:${item.event}`, { itemId, label: item.label });
      if (item.url) downloadItemUrl(item.url, item.label);
      if (item.href !== undefined) followHref(item.href, navStack);
      item.onClick?.();
      setIsOpen(false);
    }
  };

  const openSubMenu = (itemId: string, el: HTMLElement | null, focusFirst = false) => {
    setActiveSubMenu(itemId);
    setActiveSubMenuRef(el);
    setSubMenuAutoFocus(focusFirst);
  };

  const closeSubMenu = () => {
    setActiveSubMenu(null);
    setActiveSubMenuRef(null);
  };

  const closeMenu = () => {
    setIsOpen(false);
    closeSubMenu();
  };

  const openMenu = () => {
    updatePosition();
    setIsOpen(true);
  };

  focusReturnRef.current = innerControl ?? triggerRef.current;
  useDialogBehavior({ open: isOpen, containerRef: menuRef, onEscape: closeMenu, modal: false, returnFocusRef: focusReturnRef });

  // Focus lands once, when the panel first mounts.
  const panelMounted = isOpen && triggerRect !== null;
  useEffect(() => {
    if (panelMounted) focusMenuItem(menuRef.current, "first");
  }, [panelMounted]);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) openMenu();
    }
  };

  const triggerA11y = {
    "aria-haspopup": "menu" as const,
    "aria-expanded": isOpen,
    ...(isOpen ? { "aria-controls": menuId } : undefined),
  };

  const wrapsTrigger = !React.isValidElement(trigger);
  useLayoutEffect(() => {
    setInnerControl(wrapsTrigger ? triggerRef.current?.querySelector<HTMLElement>(TRIGGER_CONTROL_SELECTOR) ?? null : null);
  }, [wrapsTrigger, trigger]);

  useLayoutEffect(() => {
    if (!innerControl) return;
    innerControl.setAttribute("aria-haspopup", "menu");
    innerControl.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) innerControl.setAttribute("aria-controls", menuId);
    else innerControl.removeAttribute("aria-controls");
  }, [innerControl, isOpen, menuId]);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setActiveSubMenu(null);
        setActiveSubMenuRef(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // RTL: mirror the horizontal anchor
  const rtlMirror: Record<string, string> = {
    "top-left": "top-right", "top-right": "top-left",
    "bottom-left": "bottom-right", "bottom-right": "bottom-left",
    "top-start": "top-end", "top-end": "top-start",
    "bottom-start": "bottom-end", "bottom-end": "bottom-start",
  };
  const effectivePosition =
    direction === "rtl" ? (rtlMirror[position] ?? position) : position;

  // Non-element triggers (label strings, projected element ARRAYS — the
  // std-export `trigger: [@trait.Button1]` shape) get an interactive Box span
  // wrapper: cloning onClick/ref onto Typography silently dropped both (its
  // prop surface is fixed), leaving the menu unopenable. Bubbling from any
  // inner element reaches the wrapper, so opening never depends on the
  // trigger's components forwarding onClick/ref.
  const triggerElement = React.isValidElement(trigger) ? (
    React.cloneElement(trigger as React.ReactElement<MenuTriggerProps>, {
      ref: triggerRef,
      onClick: handleToggle,
      onKeyDown: onTriggerKeyDown,
      ...triggerA11y,
    })
  ) : (
    <Box
      as="span"
      ref={(el: HTMLDivElement | null) => { triggerRef.current = el; }}
      onClick={handleToggle}
      {...(innerControl ? undefined : { role: "button", tabIndex: 0, ...triggerA11y })}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (!innerControl && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleToggle();
        } else {
          onTriggerKeyDown(e);
        }
      }}
      className="inline-flex"
    >
      {typeof trigger === "string" || typeof trigger === "number" ? (
        <Typography variant="small" as="span">{trigger}</Typography>
      ) : (
        trigger
      )}
    </Box>
  );

  const renderMenuItems = (menuItems: MenuItem[]) =>
    menuItems.map((item, index) => {
      const isDivider = item.type === "divider";
      const itemId =
        item.id ??
        `item-${item.label.toLowerCase().replace(/\s+/g, "-")}-${index}`;
      const hasSubMenu = !!(item.subMenu && item.subMenu.length > 0);
      const isDanger = item.variant === "danger";

      if (isDivider) {
        return <Divider key={`divider-${index}`} className="my-1" />;
      }

      return (
        <MenuItemRow
          key={itemId}
          item={item}
          itemId={itemId}
          hasSubMenu={hasSubMenu}
          isDanger={isDanger}
          direction={direction}
          isSubMenuOpen={activeSubMenu === itemId}
          subMenuAutoFocus={subMenuAutoFocus}
          activeSubMenuRef={activeSubMenuRef}
          eventBus={eventBus}
          onItemClick={handleItemClick}
          openSubMenu={openSubMenu}
          closeSubMenu={closeSubMenu}
          closeMenu={closeMenu}
        />
      );
    });

  // Portal the dropdown into the theme-synced portal root with fixed coords so
  // no ancestor
  // transform (ReactFlow viewport, catalog sidebar, PreviewFrame chrome) can
  // create a new containing block and trap the panel behind sibling layers.
  const panel = isOpen && triggerRect ? (
    <div
      ref={menuRef}
      {...domPassthrough(rest)}
      className={cn("fixed z-50", menuContainerStyles, className)}
      style={computeMenuStyle(effectivePosition, triggerRect)}
      id={menuId}
      role="menu"
      onKeyDown={(e: React.KeyboardEvent) => {
        const nav = MENU_NAV_KEYS[e.key];
        if (nav) {
          e.preventDefault();
          focusMenuItem(menuRef.current, nav);
        } else if (e.key === "Tab") {
          closeMenu();
        }
      }}
    >
      {header && <div className="px-4 py-2 border-b border-border">{header}</div>}
      {renderMenuItems(items)}
      {footer && <div className="px-4 py-2 border-t border-border">{footer}</div>}
    </div>
  ) : null;

  return (
    <>
      {triggerElement}
      {panel && typeof document !== "undefined"
        ? (<ThemedPortal>{panel}</ThemedPortal>)
        : panel}
    </>
  );
};

Menu.displayName = "Menu";
