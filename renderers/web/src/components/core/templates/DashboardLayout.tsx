'use client';
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from '../../../core';
import type { IconInput } from '../../../core';
import { Button, Input, Badge, ThemeToggle, Avatar } from '../../../core';
import { Box } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Typography } from '../../../core';
import { TopNavItem } from "../molecules/TopNavItem";
import { Icon as AlmadarIcon } from '../../../core';
import { useAuthContext } from "../../../hooks/useAuthContext";
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useCurrentPagePath } from "../../../providers/CurrentPagePathContext";
import { useNavStack } from '../../../core';
import { PageTransition } from "../molecules/PageTransition";
import type { AssetUrl, EventEmit, EventKey } from "@almadar/core";
import { Menu } from "../molecules/Menu";
import { Drawer } from "../molecules/Drawer";

export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon component or string icon name (resolved by @almadar/ui Icon) */
  icon?: IconInput;
  badge?: string | number;
  children?: NavItem[];
}

/**
 * The single href that should read as "active" for currentPath, across the
 * whole nav tree (nav is capped at depth 2, so this walks root items + their
 * direct children only). Exact match wins outright; otherwise the LONGEST
 * prefix match wins. Without this, a parent whose own href is a literal path
 * prefix of a sibling's href (e.g. "Library" -> "/assets" next to "Versions"
 * -> "/assets/revisions") matches both independently and highlights
 * together — every nav item computing its own activeness via
 * `currentPath.startsWith(href + "/")` in isolation has no way to know a
 * more specific sibling also matched.
 */
function resolveActiveNavHref(items: NavItem[], currentPath: string): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    for (const href of item.children?.length ? [item.href, ...item.children.map((c) => c.href)] : [item.href]) {
      if (currentPath === href) return href;
      if (currentPath.startsWith(href + "/") && (!best || href.length > best.length)) {
        best = href;
      }
    }
  }
  return best;
}

export interface NotificationItem {
  id: string;
  /** Short label shown in the dropdown row. */
  message: string;
  /** Optional secondary text. */
  description?: string;
  /** Optional ISO timestamp string. */
  createdAt?: string;
  /** Optional flag — bell badge counts items where read !== true. */
  read?: boolean;
}

/** A generic top-bar action button. Domain-agnostic — consumers wire any
 *  combination (cart icon, profile, help, custom). Each entry renders as
 *  an icon button between the search bar and the notifications bell;
 *  click dispatches the configured event onto the bus. */
export interface TopBarAction {
  /** Lucide icon name or component. */
  icon: IconInput;
  /** Optional aria-label / tooltip. Falls back to `icon`. */
  label?: string;
  /** Bus event fired on click. Dispatched as `UI:{event}` with empty payload.
   *  Typed as `EventKey` so the pattern-sync detector marks `topBarActions`
   *  as `event-list` and the validator checks references against trait
   *  emit/listen sets.
   *
   *  Optional because an action may navigate instead of dispatching — see
   *  `navigatesTo`. At least one of the two should be set; an entry with
   *  neither renders an inert button. */
  event?: EventKey;
  /** Destination URL. Navigates through the nav stack on click, the same mechanism
   *  `ButtonGroup` / `PageHeader` / `DocumentViewer` already use for their
   *  action descriptors — the top bar was the odd one out, which forced a
   *  navigation-only button to invent an event nothing listens for. Set
   *  alongside `event` to both dispatch and navigate. */
  navigatesTo?: string;
  /** Optional badge — number or string rendered in the corner of the icon. */
  badge?: number | string;
  /** Visual variant. Default `"default"`. */
  variant?: "default" | "primary" | "danger";
}

export interface DashboardUser {
  name: string;
  /** Optional — the `.lolo` viewer binding (`viewerEmail: @user.email`)
   *  compiles to `user?.email`, and an identity without an email is legal. */
  email?: string;
  avatar?: AssetUrl;
}

export interface DashboardLayoutProps {
  /** App name shown in sidebar */
  appName?: string;
  /** Logo component or URL */
  logo?: React.ReactNode;
  /** Navigation items. Apps that need a Settings page should add it
   *  as a navItems entry, not depend on baked-in chrome. */
  navItems?: NavItem[];
  /** Current user info (optional - auto-populated from auth context if not
   *  provided). Accepts `null` as well as `undefined`: the `.lolo` substrate's
   *  signed-out spelling is `(if @config.viewerName {…} null)`, and the
   *  compiled path passes that `null` through verbatim. */
  user?: DashboardUser | null;
  /** Header actions (extra slots beyond bell/search/theme). */
  headerActions?: React.ReactNode;
  /** Show the top-bar search box. Default `false` — opt in by setting
   *  `searchEvent` (any truthy value implies showSearch) or this flag. */
  showSearch?: boolean;
  /** Declarative search event — fires `UI:{searchEvent}` on the bus
   *  when the user submits the search box (Enter key). Setting this
   *  implies `showSearch=true`. Use `onSearchSubmit` for direct React
   *  usage instead. */
  searchEvent?: EventEmit<{ value: string }>;
  /** React-side search submit callback. Used when the host wires the
   *  layout directly (not via render-ui pattern resolution). */
  onSearchSubmit?: (value: string) => void;
  /** Generic top-bar action buttons rendered between the search bar and
   *  the notifications bell. Each entry: `{icon, label?, event, badge?, variant?}`.
   *  Domain-agnostic — consumers add a cart icon, profile button, help-bubble,
   *  or any other top-bar action by appending entries. Empty array (default)
   *  renders nothing. */
  topBarActions?: TopBarAction[];
  /** Account-menu entries listed above Sign out (Settings, a profile page), each
   *  `{icon, label, event?, navigatesTo?, variant?}` like `topBarActions`. */
  userMenuItems?: TopBarAction[];
  /** Content fills the area edge to edge — no padding, no max width, full height
   *  (workspaces, canvases, maps). */
  fullBleed?: boolean;
  /** Notification list. Pass an empty array to show the bell with no
   *  badge; omit / pass null to hide the bell entirely. */
  notifications?: NotificationItem[] | null;
  /** Declarative bell click event — fires `UI:{notificationClickEvent}`
   *  on the bus with an empty payload when the user clicks the bell. */
  notificationClickEvent?: EventEmit<Record<string, never>>;
  /** React-side bell click callback. */
  onNotificationClick?: () => void;
  /** Show the theme toggle button in the header. Default `true` —
   *  universally useful for a11y / dark mode. */
  showThemeToggle?: boolean;
  /** Custom sidebar footer (optional). When omitted, the sidebar has
   *  no footer — apps that need Settings/etc. add them via navItems. */
  sidebarFooter?: React.ReactNode;
  /** Optional content region rendered between the nav links and the footer —
   *  a page tree or any consumer navigation surface; scrolls independently
   *  and takes the sidebar's remaining height. Hidden in the collapsed rail. */
  sidebarContent?: React.ReactNode;
  /** Active path used to highlight the matching nav item. Falls back
   *  to `useCurrentPagePath()` (set by `CurrentPagePathProvider`), then
   *  to `useLocation().pathname`. Production deploys can omit it; the
   *  studio preview passes the in-frame `?page=` value so highlighting
   *  works inside the embedded playground where `pathname` would be
   *  the studio route. */
  currentPath?: string;
  /** The trait's reaction to Sign out; the host ends the session through `UI:SIGN_OUT` either way. */
  onSignOut?: () => void;
  /** Layout mode. Default `"sidebar"`.
   *  - `sidebar`: Left sidebar nav + top header (classic dashboard)
   *  - `topnav`: Horizontal nav in header, no sidebar
   *  - `bottomnav`: Bottom tab bar, no sidebar
   *  - `minimal`: No nav chrome, content only
   *  - `drawer`: Sidebar nav behind a menu button at every width; content gets the full width */
  layoutMode?: "sidebar" | "topnav" | "bottomnav" | "minimal" | "drawer";
  /** Page content rendered inside the main area */
  children?: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  appName: appNameProp,
  logo,
  navItems = [],
  user: userProp,
  headerActions,
  showSearch = false,
  searchEvent,
  onSearchSubmit,
  topBarActions = [],
  userMenuItems = [],
  fullBleed = false,
  notifications,
  notificationClickEvent,
  onNotificationClick,
  showThemeToggle = true,
  sidebarFooter,
  sidebarContent,
  onSignOut: onSignOutProp,
  currentPath,
  layoutMode = "sidebar",
  children,
}) => {
  const eventBus = useEventBus();
  const navStack = useNavStack();
  const { t } = useTranslate();
  const appName = appNameProp ?? t("dashboard.defaultAppName");
  // Search is shown when explicitly toggled OR a searchEvent is wired.
  const searchEnabled = showSearch || Boolean(searchEvent) || Boolean(onSearchSubmit);
  // Bell is shown when notifications array is provided (even empty []).
  // null / undefined hides the bell entirely.
  const notificationsEnabled = Array.isArray(notifications);
  const unreadCount = notificationsEnabled
    ? notifications!.filter((n) => n.read !== true).length
    : 0;
  const handleSearchSubmit = (value: string) => {
    if (searchEvent) eventBus.emit(`UI:${searchEvent}`, { value });
    if (onSearchSubmit) onSearchSubmit(value);
  };
  const handleNotificationClick = () => {
    if (notificationClickEvent) eventBus.emit(`UI:${notificationClickEvent}`, {});
    if (onNotificationClick) onNotificationClick();
  };
  // Mirrors ButtonGroup.handleActionClick: dispatch and/or navigate, each
  // independently optional, so one descriptor can do either or both.
  const handleTopBarActionClick = (action: TopBarAction) => {
    if (action.event) eventBus.emit(`UI:${action.event}`, {});
    if (action.navigatesTo) navStack.goTo(action.navigatesTo);
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Responsive sidebar is driven by a JS-measured container width (ResizeObserver
  // on the layout root) rather than Tailwind container-query classes. The
  // open/close + tier decision then uses React state + inline styles, so
  // dismissing the drawer works in ANY consumer regardless of whether their CSS
  // build emits `@container`/`@lg/dashboard:*`/`-translate-x-full` utilities.
  // (Studio mobile/tablet preview still works — the container shrinks, the
  // observer fires.) Three tiers: full labeled sidebar ≥1024; a 64px icon RAIL
  // between 768–1024 so navigation never disappears at exactly the widths where
  // split views need room; an off-canvas drawer only on true phone widths.
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = layoutRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setLayoutWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isMobile = layoutWidth !== null && layoutWidth < 768;
  const isDrawer = layoutMode === "drawer";
  const offCanvas = isMobile || isDrawer;
  const isRail = !isDrawer && layoutWidth !== null && layoutWidth >= 768 && layoutWidth < 1024;
  // Leaving mobile (e.g. preview resized up) shouldn't leave a stale open drawer.
  useEffect(() => {
    if (!offCanvas && sidebarOpen) setSidebarOpen(false);
  }, [offCanvas, sidebarOpen]);
  const location = useLocation();
  // Resolution order: explicit prop > runtime context > router pathname.
  // The studio preview wraps the playground with `CurrentPagePathProvider`
  // so the in-frame page is what NavLink matches against. "" is not a path —
  // the std-app-layout atom forwards its `currentPath : string = ""` knob
  // unconditionally, and that empty default must not shadow the context.
  const ctxPagePath = useCurrentPagePath();
  const activePath = (currentPath || undefined) ?? ctxPagePath ?? location.pathname;
  const activeHref = useMemo(() => resolveActiveNavHref(navItems, activePath), [navItems, activePath]);
  const [topNavMenuOpen, setTopNavMenuOpen] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const navigatedFrom = useRef(activePath);
  useEffect(() => {
    setTopNavMenuOpen(false);
    setSidebarOpen(false);
    // A route change moves focus to the new page's content (not on first render).
    if (navigatedFrom.current !== activePath) {
      navigatedFrom.current = activePath;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [activePath]);

  // The declared navItems label the pages they reach in the breadcrumb trail.
  const { registerNavItems } = navStack;
  useEffect(() => {
    registerNavItems(navItems);
  }, [navItems, registerNavItems]);

  // Get the user from auth context (with prop overrides)
  const { user: authUser } = useAuthContext();

  // Use props if provided, otherwise use auth context
  const user =
    userProp ||
    (authUser
      ? {
          name: authUser.displayName || authUser.email?.split("@")[0] || t("dashboard.defaultUserName"),
          email: authUser.email || "",
          avatar: authUser.photoURL || undefined,
        }
      : null);

  // The trait's own reaction, then the host ends the session (`UI:SIGN_OUT`, a system event).
  const handleSignOut = (): void => {
    onSignOutProp?.();
    eventBus.emit("UI:SIGN_OUT", {});
  };

  const showSidebar = layoutMode === "sidebar" || isDrawer;
  const showHeader = layoutMode !== "minimal";
  const showBottomNav = layoutMode === "bottomnav";
  const isTopNav = layoutMode === "topnav";

  return (
    <Box
      ref={layoutRef}
      // `@container/dashboard` is kept for descendant grid components that opt
      // into container queries; the sidebar's own responsiveness is JS-driven
      // (see isMobile above) so it never depends on those classes being emitted.
      className={cn(
        "@container/dashboard w-full bg-background surface-page flex flex-row items-stretch",
        // A full-bleed shell is an app frame: viewport-bound, so a full-height child gets a real height.
        fullBleed ? "h-screen overflow-hidden" : "min-h-screen",
      )}
    >
      <Button
        variant="link"
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-card focus:shadow-elevation-popover"
      >
        {t('aria.skipToContent')}
      </Button>
      {showSidebar && offCanvas && sidebarOpen && (
        <Box
          className="fixed inset-0 bg-scrim z-20"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — only in sidebar mode. */}
      {showSidebar && (
        <Box
          as="aside"
          inert={offCanvas && !sidebarOpen ? true : undefined}
          className={cn(
            "z-30 flex-shrink-0 bg-card surface-material border-e-[length:var(--border-width)] border-border",
            isRail ? "w-16" : "w-64",
            "flex flex-col",
          )}
          // Position + slide driven by inline styles (not Tailwind transform /
          // container-query classes) so the drawer reliably opens/closes in any
          // consumer. Desktop: static, in-flow. Mobile: fixed off-canvas drawer.
          style={
            offCanvas
              ? {
                  position: "fixed",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
                  transition: "transform 200ms ease-in-out",
                }
              : { position: "static", transform: "none" }
          }
        >
          {/* Sidebar header */}
          <HStack
            align="center"
            justify={isRail ? "center" : "between"}
            className={cn("h-16 border-b-[length:var(--border-width)] border-border", isRail ? "px-2" : "px-4")}
          >
            <Link to="/" className="flex items-center gap-2" title={isRail ? appName : undefined}>
              {logo || (
                <Box className="w-8 h-8 bg-primary rounded-interactive flex items-center justify-center">
                  <Typography
                    variant="small"
                    className="text-primary-foreground font-bold text-sm"
                    as="span"
                  >
                    {appName.charAt(0).toUpperCase()}
                  </Typography>
                </Box>
              )}
              {!isRail && (
                <Typography
                  variant="label"
                  className="heading-voice text-foreground"
                  as="span"
                >
                  {appName}
                </Typography>
              )}
            </Link>
            {offCanvas && (
              <Button
                variant="ghost"
                className="p-2"
                onClick={() => setSidebarOpen(false)}
                aria-label={t('aria.closePanel')}
              >
                <AlmadarIcon name="x" className="h-5 w-5" />
              </Button>
            )}
          </HStack>

          {/* Navigation */}
          <VStack
            as="nav"
            aria-label={t('aria.mainNavigation')}
            gap="none"
            className={cn(
              "py-4 space-y-1 overflow-y-auto",
              sidebarContent && !isRail ? "shrink-0" : "flex-1",
              isRail ? "px-2" : "px-3",
            )}
          >
            {navItems.map((item, itemIndex) => (
              <NavLink
                key={`${itemIndex}:${item.href}`}
                item={item}
                activeHref={activeHref}
                compact={isRail}
              />
            ))}
          </VStack>

          {/* Sidebar content region — the Notion/Confluence-style tree or any
              consumer-provided navigation surface; takes the remaining height
              with its own scroll. Hidden in the collapsed rail (no room). */}
          {sidebarContent && !isRail && (
            <Box className="flex-1 overflow-y-auto border-t-[length:var(--border-width)] border-border px-2 py-3">
              {sidebarContent}
            </Box>
          )}

          {/* Sidebar footer — opt-in only. */}
          {sidebarFooter && (
            <Box className="p-4 border-t-[length:var(--border-width)] border-border">
              {sidebarFooter}
            </Box>
          )}
        </Box>
      )}

      {/* `min-w-0` so the column shrinks below its intrinsic content width. */}
      <VStack gap="none" className={cn("flex-1 min-w-0", fullBleed ? "h-full min-h-0" : "min-h-screen")}>
        {/* Header — hidden only in minimal mode. */}
        {showHeader && (
          <Box
            as="header"
            className="sticky top-0 z-20 pt-[env(safe-area-inset-top)] bg-card surface-material border-b-[length:var(--border-width)] border-border"
          >
            <HStack
              align="center"
              justify="between"
              className="h-16 px-3 @sm/dashboard:px-4 gap-2 @sm/dashboard:gap-4"
            >
              {/* Mobile menu button — only in sidebar mode. */}
              {showSidebar && offCanvas && (
                <Button
                  variant="ghost"
                  className="p-2 rounded-interactive hover:bg-muted text-muted-foreground touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={() => setSidebarOpen(true)}
                  aria-label={t('aria.openSidebar')}
                >
                  <AlmadarIcon name="menu" className="h-5 w-5" />
                </Button>
              )}

              {isTopNav && isMobile && (
                <Button
                  variant="ghost"
                  className="p-2 rounded-interactive hover:bg-muted text-muted-foreground touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
                  onClick={() => setTopNavMenuOpen(true)}
                  aria-label={t('aria.openMenu')}
                  aria-expanded={topNavMenuOpen}
                >
                  <AlmadarIcon name="menu" className="h-5 w-5" />
                </Button>
              )}

              {/* Phone app bar names the app; it gives way to an open search. */}
              {isMobile && !searchOpen && (
                <Typography variant="label" weight="medium" truncate className="flex-1 min-w-0 text-foreground">
                  {appName}
                </Typography>
              )}

              {/* Drawer mode on a wide screen: the brand sits beside the menu button. */}
              {isDrawer && !isMobile && (
                <Link to="/" className="flex items-center gap-2 shrink-0">
                  {logo}
                  <Typography variant="label" className="heading-voice text-foreground" as="span">
                    {appName}
                  </Typography>
                </Link>
              )}

              {/* Topnav horizontal nav — replaces sidebar. */}
              {isTopNav && !isMobile && (
                <HStack
                  as="nav"
                  aria-label={t('aria.mainNavigation')}
                  align="center"
                  gap="none"
                  className="flex items-center gap-1 overflow-x-auto"
                >
                  <Link to="/" className="flex items-center gap-2 mr-3 shrink-0">
                    {logo || (
                      <Box className="w-7 h-7 bg-primary rounded-interactive flex items-center justify-center">
                        <Typography
                          variant="small"
                          className="text-primary-foreground font-bold text-xs"
                          as="span"
                        >
                          {appName.charAt(0).toUpperCase()}
                        </Typography>
                      </Box>
                    )}
                    <Typography
                      variant="label"
                      className="heading-voice text-foreground"
                      as="span"
                    >
                      {appName}
                    </Typography>
                  </Link>
                  {navItems.map((item, itemIndex) => (
                    <TopNavItem
                      key={`${itemIndex}:${item.href}`}
                      item={item}
                      activeHref={activeHref}
                      tone="solid"
                    />
                  ))}
                </HStack>
              )}

              {/* On phones search collapses to an icon that expands the field; capped width on `xl+`. */}
              {searchEnabled && (
                <Box
                  data-dashboard-search
                  className={cn(
                    "flex-1 min-w-0 @xl/dashboard:max-w-md",
                    isMobile && !searchOpen ? "hidden" : "block",
                  )}
                >
                  <Input
                    type="search"
                    icon="search"
                    placeholder={t('common.search')}
                    className="w-full"
                    autoFocus={isMobile && searchOpen}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearchSubmit((e.target as HTMLInputElement).value);
                      } else if (e.key === 'Escape' && isMobile) {
                        setSearchOpen(false);
                      }
                    }}
                  />
                </Box>
              )}
              {searchEnabled && isMobile && (
                <Button
                  variant="ghost"
                  icon={searchOpen ? "x" : "search"}
                  onClick={() => setSearchOpen((open) => !open)}
                  aria-label={t('aria.search')}
                  aria-expanded={searchOpen}
                  className="shrink-0 min-h-[44px] min-w-[44px]"
                />
              )}
              {!searchEnabled && <Box className="flex-1" />}

              {/* Right side */}
              <HStack align="center" gap="xs">
                {headerActions}

                {/* Theme Toggle — opt-out via showThemeToggle={false}. */}
                {showThemeToggle && <ThemeToggle />}

                {/* Generic top-bar actions — consumer-supplied. */}
                {topBarActions.map((action, idx) => (
                  <Button
                    key={`${action.event ?? action.navigatesTo ?? 'action'}-${idx}`}
                    variant="ghost"
                    className="relative p-2"
                    onClick={() => handleTopBarActionClick(action)}
                    aria-label={action.label ?? (typeof action.icon === 'string' ? action.icon : undefined)}
                  >
                    <AlmadarIcon icon={action.icon} className="h-5 w-5 text-muted-foreground" />
                    {action.badge !== undefined && action.badge !== null && action.badge !== 0 && action.badge !== '' && (
                      <Box
                        as="span"
                        className={cn(
                          "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-xs font-semibold flex items-center justify-center",
                          action.variant === "danger" ? "bg-error text-error-foreground" : action.variant === "primary" ? "bg-primary text-primary-foreground" : "bg-foreground text-background"
                        )}
                      >
                        {action.badge}
                      </Box>
                    )}
                  </Button>
                ))}

                {/* Notifications */}
                {notificationsEnabled && (
                  <Button
                    variant="ghost"
                    className="relative p-2"
                    onClick={handleNotificationClick}
                    aria-label={t('common.notifications')}
                  >
                    <AlmadarIcon name="bell" className="h-5 w-5 text-muted-foreground" />
                    {unreadCount > 0 && (
                      <Box
                        as="span"
                        className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-error rounded-full text-xs font-semibold text-error-foreground flex items-center justify-center"
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </Box>
                    )}
                  </Button>
                )}

                {/* User menu — `user.name` is read unguarded below, so a
                    partial user object must not open this branch. */}
                {user?.name && (
                  <Menu
                    position="bottom-end"
                    header={
                      <VStack gap="none">
                        <Typography variant="small" weight="medium" as="p">{user.name}</Typography>
                        {user.email && <Typography variant="caption" color="muted" as="p">{user.email}</Typography>}
                      </VStack>
                    }
                    trigger={
                      <Button variant="ghost" className="flex items-center gap-2 p-2">
                        <Avatar
                          src={user.avatar}
                          alt={user.name}
                          initials={user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .substring(0, 2)}
                          size="sm"
                        />
                        <Typography variant="small" weight="medium" as="span" className="hidden @sm/dashboard:block text-foreground">
                          {user.name}
                        </Typography>
                        <AlmadarIcon name="chevron-down" className="hidden @sm/dashboard:block h-4 w-4 text-muted-foreground" />
                      </Button>
                    }
                    items={[
                      ...userMenuItems.map((action, idx) => ({
                        id: `${action.event ?? action.navigatesTo ?? 'entry'}-${idx}`,
                        label: action.label ?? '',
                        icon: action.icon,
                        variant: action.variant === 'danger' ? 'danger' as const : undefined,
                        onClick: () => handleTopBarActionClick(action),
                      })),
                      { id: 'sign-out', label: t('auth.signOut'), icon: 'log-out', variant: 'danger', onClick: () => handleSignOut?.() },
                    ]}
                  />
                )}
              </HStack>
            </HStack>
          </Box>
        )}

        {isTopNav && isMobile && (
          <Drawer
            isOpen={topNavMenuOpen}
            onClose={() => setTopNavMenuOpen(false)}
            title={appName}
            position="left"
          >
            <VStack as="nav" aria-label={t('aria.mainNavigation')} gap="none" className="space-y-1">
              {navItems.map((item, itemIndex) => (
                <NavLink key={`${itemIndex}:${item.href}`} item={item} activeHref={activeHref} />
              ))}
            </VStack>
          </Drawer>
        )}

        <Box
          as="main"
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className={cn(
            fullBleed ? "flex-1 min-h-0 flex flex-col overflow-y-auto focus:outline-none" : "flex-1 p-3 @sm/dashboard:p-4 @md/dashboard:p-6 focus:outline-none",
            // Reserve space for the fixed bottom nav so content isn't
            // hidden under the tab bar.
            showBottomNav && "pb-[calc(5rem+env(safe-area-inset-bottom))]",
          )}
        >
          <PageTransition locationKey={activePath} className={fullBleed ? "w-full flex-1 min-h-0" : "mx-auto w-full max-w-[1440px]"}>{children}</PageTransition>
        </Box>

        {/* Bottom nav — only in bottomnav mode. Fixed to viewport bottom
            so the tab bar stays anchored regardless of content scroll
            position (canonical mobile tab-bar pattern). Sidebar and
            bottomnav layoutModes are mutually exclusive, so `inset-x-0`
            is safe — it cannot collide with the sidebar's left rail. */}
        {showBottomNav && (
          <Box
            as="nav"
            aria-label={t('aria.mainNavigation')}
            className="fixed bottom-0 inset-x-0 z-20 pb-[env(safe-area-inset-bottom)] bg-card surface-material border-t-[length:var(--border-width)] border-border"
          >
            <HStack align="center" justify="around" className="h-16 px-2">
              {navItems.map((item, itemIndex) => (
                <NavLinkBottom
                  key={`${itemIndex}:${item.href}`}
                  item={item}
                  activeHref={activeHref}
                />
              ))}
            </HStack>
          </Box>
        )}
      </VStack>
    </Box>
  );
};

DashboardLayout.displayName = "DashboardLayout";

// NavLink component
const NavLink: React.FC<{ item: NavItem; activeHref?: string; compact?: boolean }> = ({
  item,
  activeHref,
  compact = false,
}) => {
  const hasChildren = !!item.children?.length;
  const childActive = hasChildren && item.children!.some((child) => child.href === activeHref);
  const isActive = item.href === activeHref || childActive;
  // Starts expanded when a child route is already active, so landing on a
  // nested page doesn't hide the group it belongs to.
  const [open, setOpen] = useState(childActive);

  const iconClassName = cn(
    "h-5 w-5",
    isActive
      ? "text-primary-foreground"
      : "text-muted-foreground",
  );

  // Rail mode: the item collapses to its icon — label becomes the tooltip and
  // accessible name, a badge rides the icon's corner so counts stay visible.
  // An icon-less item shows its label's first letter so it never disappears.
  if (compact) {
    if (hasChildren) {
      return (
        <Box className="relative">
          <Button
            variant="ghost"
            title={item.label}
            aria-label={item.label}
            aria-expanded={open}
            className={cn(
              "flex items-center justify-center w-full px-2 py-2 rounded-interactive transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-elevation-interactive"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => setOpen(!open)}
          >
            <Box as="span" className="relative inline-flex">
              {item.icon ? (
                typeof item.icon === 'string'
                  ? <AlmadarIcon name={item.icon} className={iconClassName} />
                  : <item.icon className={iconClassName} />
              ) : (
                <Typography variant="small" className="font-semibold" as="span">
                  {item.label.charAt(0).toUpperCase()}
                </Typography>
              )}
              {item.badge && (
                <Badge
                  variant={isActive ? "primary" : "default"}
                  size="sm"
                  className="absolute -top-2 -right-2 px-1 py-0 text-[10px] leading-4"
                >
                  {item.badge}
                </Badge>
              )}
            </Box>
          </Button>

          {open && (
            <>
              <Box className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
              <Box className="absolute left-full top-0 ml-2 w-48 bg-card surface-material rounded-container shadow-elevation-popover border border-border py-1 z-30">
                {item.children!.map((child, childIndex) => {
                  const childIsActive = child.href === activeHref;
                  return (
                    <Link
                      key={`${childIndex}:${child.href}`}
                      to={child.href}
                      aria-current={child.href === activeHref ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                        childIsActive
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {child.icon && (
                        typeof child.icon === 'string'
                          ? <AlmadarIcon name={child.icon} className="h-4 w-4" />
                          : <child.icon className="h-4 w-4" />
                      )}
                      <Typography variant="small" className="flex-1" as="span">
                        {child.label}
                      </Typography>
                      {child.badge && (
                        <Badge variant={childIsActive ? "primary" : "default"} size="sm">
                          {child.badge}
                        </Badge>
                      )}
                    </Link>
                  );
                })}
              </Box>
            </>
          )}
        </Box>
      );
    }

    return (
      <Link
        to={item.href}
        aria-current={item.href === activeHref ? "page" : undefined}
        title={item.label}
        aria-label={item.label}
        className={cn(
          "flex items-center justify-center px-2 py-2 rounded-interactive transition-colors",
          isActive
            ? "bg-primary text-primary-foreground shadow-elevation-interactive"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Box as="span" className="relative inline-flex">
          {item.icon ? (
            typeof item.icon === 'string'
              ? <AlmadarIcon name={item.icon} className={iconClassName} />
              : <item.icon className={iconClassName} />
          ) : (
            <Typography variant="small" className="font-semibold" as="span">
              {item.label.charAt(0).toUpperCase()}
            </Typography>
          )}
          {item.badge && (
            <Badge
              variant={isActive ? "primary" : "default"}
              size="sm"
              className="absolute -top-2 -right-2 px-1 py-0 text-[10px] leading-4"
            >
              {item.badge}
            </Badge>
          )}
        </Box>
      </Link>
    );
  }

  if (hasChildren) {
    return (
      <Box>
        <Button
          variant="ghost"
          aria-expanded={open}
          className={cn(
            "flex items-center gap-3 w-full px-3 py-2 rounded-interactive text-sm font-medium transition-colors",
            isActive
              ? "bg-primary text-primary-foreground shadow-elevation-interactive"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          onClick={() => setOpen(!open)}
        >
          {item.icon && (
            typeof item.icon === 'string'
              ? <AlmadarIcon name={item.icon} className={iconClassName} />
              : <item.icon className={iconClassName} />
          )}
          <Typography
            variant="small"
            color={isActive ? 'inherit' : 'primary'}
            className="flex-1 text-left"
            as="span"
          >
            {item.label}
          </Typography>
          {item.badge && (
            <Badge variant={isActive ? "primary" : "default"} size="sm">
              {item.badge}
            </Badge>
          )}
          <AlmadarIcon
            name="chevron-down"
            className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
          />
        </Button>

        {open && (
          <VStack
            gap="none"
            className="mt-1 ml-4 pl-4 border-s-[length:var(--border-width)] border-border space-y-1"
          >
            {item.children!.map((child, childIndex) => {
              const childIsActive = child.href === activeHref;
              return (
                <Link
                  key={`${childIndex}:${child.href}`}
                  to={child.href}
                  aria-current={child.href === activeHref ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-interactive text-sm transition-colors",
                    childIsActive
                      ? "bg-primary text-primary-foreground shadow-elevation-interactive"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {child.icon && (
                    typeof child.icon === 'string'
                      ? <AlmadarIcon name={child.icon} className="h-4 w-4" />
                      : <child.icon className="h-4 w-4" />
                  )}
                  <Typography
                    variant="small"
                    color={childIsActive ? 'inherit' : 'primary'}
                    className="flex-1"
                    as="span"
                  >
                    {child.label}
                  </Typography>
                  {child.badge && (
                    <Badge variant={childIsActive ? "primary" : "default"} size="sm">
                      {child.badge}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </VStack>
        )}
      </Box>
    );
  }

  return (
    <Link
      to={item.href}
      aria-current={item.href === activeHref ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-interactive text-sm font-medium transition-colors",
        isActive
          ? "bg-primary text-primary-foreground shadow-elevation-interactive"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {item.icon && (
        typeof item.icon === 'string'
          ? <AlmadarIcon name={item.icon} className={iconClassName} />
          : <item.icon className={iconClassName} />
      )}
      <Typography
        variant="small"
        color={isActive ? 'inherit' : 'primary'}
        className="flex-1"
        as="span"
      >
        {item.label}
      </Typography>
      {item.badge && (
        <Badge variant={isActive ? "primary" : "default"} size="sm">
          {item.badge}
        </Badge>
      )}
    </Link>
  );
};

NavLink.displayName = "NavLink";

// Topnav nav link — compact horizontal style
// Bottom nav link — icon-only with label below (mobile tab bar style).
// `children` is intentionally not rendered here: a fixed-height tab bar has
// no room for a flyout, and mobile tab bars are a flat-only pattern.
const NavLinkBottom: React.FC<{ item: NavItem; activeHref?: string }> = ({
  item,
  activeHref,
}) => {
  const isActive = item.href === activeHref;

  const iconClassName = cn(
    "h-5 w-5",
    isActive
      ? "text-primary"
      : "text-muted-foreground",
  );

  return (
    <Link
      to={item.href}
      aria-current={item.href === activeHref ? "page" : undefined}
      className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-interactive transition-colors flex-1 min-w-0"
    >
      {item.icon && (
        typeof item.icon === 'string'
          ? <AlmadarIcon name={item.icon} className={iconClassName} />
          : <item.icon className={iconClassName} />
      )}
      <Typography
        variant="caption"
        className={cn(
          "text-xs leading-tight truncate max-w-full",
          isActive ? "text-primary font-medium" : "text-muted-foreground",
        )}
        as="span"
      >
        {item.label}
      </Typography>
      {item.badge && (
        <Badge variant={isActive ? "primary" : "default"} size="sm" className="text-xs px-1 py-0 min-w-0">
          {item.badge}
        </Badge>
      )}
    </Link>
  );
};

NavLinkBottom.displayName = "NavLinkBottom";
